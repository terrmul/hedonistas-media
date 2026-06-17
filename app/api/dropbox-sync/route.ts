import { NextRequest, NextResponse } from 'next/server' 
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { supabase } from '@/lib/supabase'

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm', '.wmv']
const THUMBNAIL_SUPPORTED = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif', '.gif', '.bmp']

function getFileType(name: string): 'image' | 'video' | null {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  return null
}

function supportNativeThumb(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  return THUMBNAIL_SUPPORTED.includes(ext)
}

async function getDropboxThumbnail(dbx: Dropbox, filePath: string): Promise<Buffer | null> {
  try {
    const response = await (dbx as any).filesGetThumbnailV2({
      resource: { '.tag': 'path', path: filePath },
      format: { '.tag': 'jpeg' },
      size: { '.tag': 'w640h480' },
      mode: { '.tag': 'fitone_bestfit' }
    }) as any
    const arrayBuffer = await response.result.fileBlob.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

async function uploadThumbnail(thumbnail: Buffer, fileName: string): Promise<string> {
  const thumbName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${fileName.replace(/\.[^.]+$/, '')}.jpg`
  const { data: uploadData } = await supabase.storage
    .from('thumbnails')
    .upload(thumbName, thumbnail, { contentType: 'image/jpeg' })
  if (uploadData) {
    const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(thumbName)
    return urlData.publicUrl
  }
  return ''
}

async function getDropboxUrl(dbx: Dropbox, filePath: string, fileId?: string): Promise<string> {
  try {
    const linkResult = await dbx.sharingCreateSharedLinkWithSettings({ path: filePath })
    return linkResult.result.url.replace('?dl=0', '?raw=1')
  } catch {
    try {
      const links = await dbx.sharingListSharedLinks({ path: filePath, direct_only: true })
      if (links.result.links.length > 0) {
        return links.result.links[0].url.replace('?dl=0', '?raw=1')
      }
    } catch {}
    const id = fileId?.replace('id:', '')
    return id
      ? `https://www.dropbox.com/home?quickview=id%3A${id}`
      : `https://www.dropbox.com/home${filePath}`
  }
}

const CURSOR_KEY = 'dropbox_sync_cursor'
const CURSOR_PATH_KEY = 'dropbox_sync_cursor_path'

async function getSavedCursor(path: string): Promise<string | null> {
  const { data } = await supabase.from('sync_state').select('value').eq('key', CURSOR_KEY).single()
  const { data: pathData } = await supabase.from('sync_state').select('value').eq('key', CURSOR_PATH_KEY).single()
  if (pathData?.value === path && data?.value) return data.value
  return null
}

async function saveCursor(cursor: string, path: string): Promise<void> {
  await supabase.from('sync_state').upsert({ key: CURSOR_KEY, value: cursor })
  await supabase.from('sync_state').upsert({ key: CURSOR_PATH_KEY, value: path })
}

async function clearCursor(): Promise<void> {
  await supabase.from('sync_state').delete().eq('key', CURSOR_KEY)
  await supabase.from('sync_state').delete().eq('key', CURSOR_PATH_KEY)
}

export async function POST(req: NextRequest) {
  try {
    const { path = '', limit = 100, specificFiles = [], tagOnSync = false, resetCursor = false } = await req.json()

    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin

    const { data: existing } = await supabase.from('assets').select('dropbox_path')
    const existingPaths = new Set((existing || []).map((a: any) => a.dropbox_path))

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          if (specificFiles.length > 0) {
            const filesToProcess = specificFiles
              .map((p: string) => ({ path_lower: p, name: p.split('/').pop() || p }))
              .filter((f: any) => !existingPaths.has(f.path_lower) && getFileType(f.name) !== null)

            send({ type: 'start', total: filesToProcess.length, grandTotal: filesToProcess.length })
            let processed = 0, failed = 0, skipped = specificFiles.length - filesToProcess.length

            for (const file of filesToProcess) {
              try {
                const fileType = getFileType(file.name)!
                let thumbnailUrl = ''
                const thumb = await getDropboxThumbnail(dbx, file.path_lower)
                if (thumb) thumbnailUrl = await uploadThumbnail(thumb, file.name)
                const dropboxUrl = await getDropboxUrl(dbx, file.path_lower, file.id)
                const { data: inserted } = await supabase.from('assets').insert({
                  name: file.name, type: fileType, url: dropboxUrl,
                  thumbnail_url: thumbnailUrl, dropbox_path: file.path_lower,
                  tags: [], analyzed: false
                }).select('id').single()
                if (tagOnSync && inserted?.id) {
                  fetch(`${origin}/api/tag-untagged`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assetId: inserted.id })
                  }).catch(() => {})
                }
                processed++
                send({ type: 'progress', processed, failed, skipped, total: filesToProcess.length, grandTotal: filesToProcess.length, current: file.name })
              } catch (err) {
                console.error('Failed:', file.name, err)
                failed++
                send({ type: 'progress', processed, failed, skipped, total: filesToProcess.length, grandTotal: filesToProcess.length, current: file.name })
              }
            }
            send({ type: 'complete', processed, failed, skipped, total: filesToProcess.length, grandTotal: filesToProcess.length, hasMore: false })
            controller.close()
            return
          }

          if (!path || path.trim() === '') {
            send({ type: 'error', message: 'Please provide a Dropbox folder path' })
            controller.close()
            return
          }

          if (resetCursor) await clearCursor()

          let cursor = resetCursor ? null : await getSavedCursor(path)
          let files: any[] = []
          let hasMore = false
          let newCursor = ''

          if (cursor) {
            send({ type: 'status', message: 'Resuming from saved position...' })
            const response = await dbx.filesListFolderContinue({ cursor })
            files = response.result.entries.filter((e: any) => e['.tag'] === 'file')
            hasMore = response.result.has_more
            newCursor = response.result.cursor
          } else {
            send({ type: 'status', message: 'Scanning folder...' })
            const response = await dbx.filesListFolder({ path, recursive: true, limit: 2000 })
            files = response.result.entries.filter((e: any) => e['.tag'] === 'file')
            hasMore = response.result.has_more
            newCursor = response.result.cursor
            // Keep paginating until we find media files or run out of pages
            while (hasMore && files.filter((f: any) => !existingPaths.has(f.path_lower) && getFileType(f.name) !== null).length === 0) {
              const next = await dbx.filesListFolderContinue({ cursor: newCursor })
              files.push(...next.result.entries.filter((e: any) => e['.tag'] === 'file'))
              hasMore = next.result.has_more
              newCursor = next.result.cursor
            }
          }

          const mediaFiles = files
            .filter((f: any) => !existingPaths.has(f.path_lower) && getFileType(f.name) !== null)
            .slice(0, limit)

          const grandTotal = mediaFiles.length + (hasMore ? 999 : 0)
          send({ type: 'start', total: mediaFiles.length, grandTotal, hasMore })

          let processed = 0, failed = 0, skipped = files.length - mediaFiles.length

          for (const file of mediaFiles) {
            try {
              const fileType = getFileType(file.name)!
              let thumbnailUrl = ''
              const thumb = await getDropboxThumbnail(dbx, file.path_lower)
              if (thumb) thumbnailUrl = await uploadThumbnail(thumb, file.name)
              const { data: inserted } = await supabase.from('assets').insert({
                name: file.name, type: fileType, url: '',
                thumbnail_url: thumbnailUrl, dropbox_path: file.path_lower,
                tags: [], analyzed: false
              }).select('id').single()
              if (tagOnSync && inserted?.id) {
                fetch(`${origin}/api/tag-untagged`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ assetId: inserted.id })
                }).catch(() => {})
              }
              processed++
              send({ type: 'progress', processed, failed, skipped, total: mediaFiles.length, grandTotal, current: file.name })
            } catch (err) {
              console.error('Failed:', file.name, err)
              failed++
              send({ type: 'progress', processed, failed, skipped, total: mediaFiles.length, grandTotal, current: file.name })
            }
          }

          if (newCursor) {
            await saveCursor(newCursor, path)
          } else {
            await clearCursor()
          }

          send({ type: 'complete', processed, failed, skipped, total: mediaFiles.length, grandTotal, hasMore })
          controller.close()
        } catch (err) {
          console.error('Sync stream error:', err)
          send({ type: 'error', message: String(err) })
          controller.close()
        }
      }
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
