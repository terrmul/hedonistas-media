import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { supabase } from '@/lib/supabase'

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm', '.wmv']

function getFileType(name: string): 'image' | 'video' | null {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  return null
}

function isHeic(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return ext === 'heic' || ext === 'heif'
}

async function listAllFiles(dbx: Dropbox, path: string): Promise<any[]> {
  const files: any[] = []
  let response = await dbx.filesListFolder({ path, recursive: true })
  files.push(...response.result.entries)
  while (response.result.has_more) {
    response = await dbx.filesListFolderContinue({ cursor: response.result.cursor })
    files.push(...response.result.entries)
  }
  return files.filter((f: any) => f['.tag'] === 'file')
}

async function generateImageThumbnail(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  try {
    let jpegBuffer = buffer
    if (isHeic(fileName)) {
      const heicConvert = (await import('heic-convert')).default
      const converted = await heicConvert({ buffer, format: 'JPEG', quality: 0.85 })
      jpegBuffer = Buffer.from(converted)
    }
    const sharp = (await import('sharp')).default
    return await sharp(jpegBuffer, { failOn: 'none' })
      .rotate()
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer()
  } catch (err) {
    console.error('Image thumbnail failed:', err)
    return null
  }
}

async function generateVideoThumbnail(dbx: Dropbox, filePath: string): Promise<Buffer | null> {
  try {
    const response = await (dbx as any).filesGetThumbnailV2({
      resource: { '.tag': 'path', path: filePath },
      format: { '.tag': 'jpeg' },
      size: { '.tag': 'w640h480' }
    }) as any
    const arrayBuffer = await response.result.fileBlob.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (err) {
    console.error('Dropbox video thumbnail failed:', err)
    return null
  }
}

async function uploadThumbnail(thumbnail: Buffer, fileName: string): Promise<string> {
  const thumbName = `${Date.now()}_${fileName.replace(/\.[^.]+$/, '')}.jpg`
  const { data: uploadData } = await supabase.storage
    .from('thumbnails')
    .upload(thumbName, thumbnail, { contentType: 'image/jpeg' })
  if (uploadData) {
    const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(thumbName)
    return urlData.publicUrl
  }
  return ''
}

async function tagAsset(assetId: string, origin: string): Promise<void> {
  await fetch(`${origin}/api/tag-untagged`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId })
  })
}

async function processFile(dbx: Dropbox, file: any, existingPaths: Set<string>, tagOnSync: boolean, origin: string) {
  if (existingPaths.has(file.path_lower)) return { status: 'skipped' }
  const fileType = getFileType(file.name)
  if (!fileType) return { status: 'skipped' }

  const download = await dbx.filesDownload({ path: file.path_lower }) as any
  const arrayBuffer = await download.result.fileBlob.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  let thumbnailUrl = ''
  try {
    let thumbnail: Buffer | null = null
    if (fileType === 'image') thumbnail = await generateImageThumbnail(buffer, file.name)
    else if (fileType === 'video') thumbnail = await generateVideoThumbnail(dbx, file.path_lower)
    if (thumbnail) thumbnailUrl = await uploadThumbnail(thumbnail, file.name)
  } catch (thumbErr) {
    console.error('Thumbnail failed for', file.name, thumbErr)
  }

  let dropboxUrl = ''
  try {
    const linkResult = await dbx.sharingCreateSharedLinkWithSettings({ path: file.path_lower })
    dropboxUrl = linkResult.result.url.replace('?dl=0', '?raw=1')
  } catch {
    try {
      const links = await dbx.sharingListSharedLinks({ path: file.path_lower, direct_only: true })
      if (links.result.links.length > 0) {
        dropboxUrl = links.result.links[0].url.replace('?dl=0', '?raw=1')
      } else if (file.id) {
        const cleanId = file.id.replace('id:', '')
        dropboxUrl = `https://www.dropbox.com/home?quickview=id%3A${cleanId}`
      } else {
        dropboxUrl = `https://www.dropbox.com/home${file.path_lower}`
      }
    } catch {
      dropboxUrl = `https://www.dropbox.com/home${file.path_lower}`
    }
  }

  const { data: inserted } = await supabase.from('assets').insert({
    name: file.name,
    type: fileType,
    url: dropboxUrl,
    thumbnail_url: thumbnailUrl,
    dropbox_path: file.path_lower,
    tags: [],
    analyzed: false
  }).select('id').single()

  if (tagOnSync && inserted?.id) {
    await tagAsset(inserted.id, origin)
  }

  return { status: 'processed', name: file.name }
}

export async function POST(req: NextRequest) {
  try {
    const { path = '', limit = 25, specificFiles = [], tagOnSync = false, autoBatch = false } = await req.json()

    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin

    const { data: existing } = await supabase.from('assets').select('dropbox_path')
    const existingPaths = new Set((existing || []).map((a: any) => a.dropbox_path))

    let allFiles: any[] = []

    if (specificFiles.length > 0) {
      allFiles = specificFiles.map((p: string) => ({
        path_lower: p,
        name: p.split('/').pop() || p
      }))
    } else {
      if (!path || path.trim() === '') {
        return NextResponse.json({ error: 'Please provide a Dropbox folder path' }, { status: 400 })
      }
      const files = await listAllFiles(dbx, path)
      const mediaFiles = files.filter((f: any) => getFileType(f.name) !== null)
      allFiles = mediaFiles.filter((f: any) => !existingPaths.has(f.path_lower))
    }

    const grandTotal = allFiles.length
    const filesToProcess = autoBatch ? allFiles : allFiles.slice(0, limit)
    const total = filesToProcess.length

    let processed = 0
    let failed = 0
    let skipped = 0

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        send({ type: 'start', total, grandTotal })

        for (const file of filesToProcess) {
          try {
            const result = await processFile(dbx, file, existingPaths, tagOnSync, origin)
            if (result.status === 'processed') {
              processed++
              send({ type: 'progress', processed, failed, skipped, total, grandTotal, current: file.name })
            } else {
              skipped++
            }
          } catch (err) {
            console.error(`Failed to process ${file.name}:`, err)
            failed++
            send({ type: 'progress', processed, failed, skipped, total, current: file.name, grandTotal })
          }
        }

        send({ type: 'complete', processed, failed, skipped, total, grandTotal, hasMore: grandTotal > total && !autoBatch })
        controller.close()
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
