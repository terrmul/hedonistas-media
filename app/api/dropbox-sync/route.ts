import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { supabase } from '@/lib/supabase'

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm', '.wmv']
const DOCUMENT_EXTENSIONS = ['.pdf']

function getFileType(name: string): 'image' | 'video' | 'document' | null {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (DOCUMENT_EXTENSIONS.includes(ext)) return 'document'
  return null
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

async function generateThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default
    return await sharp(buffer)
      .rotate()
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer()
  } catch {
    return null
  }
}

async function processFile(dbx: Dropbox, file: any, existingPaths: Set<string>) {
  if (existingPaths.has(file.path_lower)) return { status: 'skipped' }
  const fileType = getFileType(file.name)
  if (!fileType) return { status: 'skipped' }

  const download = await dbx.filesDownload({ path: file.path_lower }) as any
  const arrayBuffer = await download.result.fileBlob.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  let thumbnailUrl = ''
  if (fileType === 'image') {
    try {
      const thumbnail = await generateThumbnail(buffer)
      if (thumbnail) {
        const thumbName = `${Date.now()}_${file.name.replace(/\.[^.]+$/, '')}.jpg`
        const { data: uploadData } = await supabase.storage
          .from('thumbnails')
          .upload(thumbName, thumbnail, { contentType: 'image/jpeg' })
        if (uploadData) {
          const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(thumbName)
          thumbnailUrl = urlData.publicUrl
        }
      }
    } catch (thumbErr) {
      console.error('Thumbnail failed for', file.name, thumbErr)
    }
  }

  let dropboxUrl = ''
  try {
    const linkResult = await dbx.sharingCreateSharedLinkWithSettings({ path: file.path_lower })
    dropboxUrl = linkResult.result.url.replace('?dl=0', '?raw=1')
  } catch {
    dropboxUrl = `https://www.dropbox.com/home${file.path_lower}`
  }

  await supabase.from('assets').insert({
    name: file.name,
    type: fileType,
    url: dropboxUrl,
    thumbnail_url: thumbnailUrl,
    dropbox_path: file.path_lower,
    tags: [],
    analyzed: false
  })

  return { status: 'processed', name: file.name }
}

export async function POST(req: NextRequest) {
  try {
    const { path = '', limit = 25, specificFiles = [] } = await req.json()

    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const { data: existing } = await supabase.from('assets').select('dropbox_path')
    const existingPaths = new Set((existing || []).map((a: any) => a.dropbox_path))

    let filesToProcess: any[] = []

    if (specificFiles.length > 0) {
      filesToProcess = specificFiles.map((p: string) => ({
        path_lower: p,
        name: p.split('/').pop() || p
      }))
    } else {
      if (!path || path.trim() === '') {
        return NextResponse.json({ error: 'Please provide a Dropbox folder path' }, { status: 400 })
      }
      const files = await listAllFiles(dbx, path)
      const mediaFiles = files.filter((f: any) => getFileType(f.name) !== null)
      const newFiles = mediaFiles.filter((f: any) => !existingPaths.has(f.path_lower))
      filesToProcess = newFiles.slice(0, limit)
    }

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

        send({ type: 'start', total })

        for (const file of filesToProcess) {
          try {
            const result = await processFile(dbx, file, existingPaths)
            if (result.status === 'processed') {
              processed++
              send({ type: 'progress', processed, failed, skipped, total, current: file.name })
            } else {
              skipped++
            }
          } catch (err) {
            console.error(`Failed to process ${file.name}:`, err)
            failed++
            send({ type: 'progress', processed, failed, skipped, total, current: file.name })
          }
        }

        send({ type: 'complete', processed, failed, skipped, total })
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
