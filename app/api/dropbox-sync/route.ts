import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { supabase } from '@/lib/supabase'
import sharp from 'sharp'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

async function generateImageThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    // sharp handles HEIC natively on Linux via libvips
    return await sharp(buffer)
      .rotate()
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer()
  } catch {
    return null
  }
}

/** Find ffmpeg: prefer Vercel Lambda layer path, fall back to system PATH */
function ffmpegPath(): string {
  const candidates = [
    '/opt/bin/ffmpeg',          // Vercel/Lambda layer
    '/usr/local/bin/ffmpeg',    // macOS Homebrew / custom install
    'ffmpeg',                   // system PATH
  ]
  for (const p of candidates) {
    try {
      execSync(`${p} -version`, { stdio: 'ignore' })
      return p
    } catch {}
  }
  throw new Error('ffmpeg not found')
}

async function generateVideoThumbnail(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  const tmpDir = tmpdir()
  const inputPath = join(tmpDir, `vid_in_${Date.now()}_${fileName}`)
  const outputPath = join(tmpDir, `vid_thumb_${Date.now()}.jpg`)
  try {
    writeFileSync(inputPath, buffer)
    const ff = ffmpegPath()
    execSync(`"${ff}" -i "${inputPath}" -ss 00:00:03 -vframes 1 -vf scale=400:-1 "${outputPath}" -y 2>/dev/null`, { timeout: 30000 })
    if (existsSync(outputPath)) {
      const frame = readFileSync(outputPath)
      try { unlinkSync(inputPath) } catch {}
      try { unlinkSync(outputPath) } catch {}
      return frame
    }
    try { unlinkSync(inputPath) } catch {}
    return null
  } catch {
    try { unlinkSync(inputPath) } catch {}
    try { unlinkSync(outputPath) } catch {}
    return null
  }
}

async function generatePdfThumbnail(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  const tmpDir = tmpdir()
  const inputPath = join(tmpDir, `pdf_in_${Date.now()}_${fileName}`)
  const outputBase = join(tmpDir, `pdf_thumb_${Date.now()}`)
  try {
    writeFileSync(inputPath, buffer)
    // pdftoppm ships with poppler-utils — available in Vercel build image and Linux
    execSync(`pdftoppm -jpeg -r 72 -f 1 -l 1 "${inputPath}" "${outputBase}"`, { timeout: 15000 })
    // pdftoppm writes <outputBase>-1.jpg (or -01.jpg depending on version)
    const candidates = [`${outputBase}-1.jpg`, `${outputBase}-01.jpg`]
    for (const c of candidates) {
      if (existsSync(c)) {
        const raw = readFileSync(c)
        // Resize to standard thumbnail size
        const resized = await sharp(raw).resize(400, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
        try { unlinkSync(c) } catch {}
        try { unlinkSync(inputPath) } catch {}
        return resized
      }
    }
    try { unlinkSync(inputPath) } catch {}
    return null
  } catch (err) {
    console.error('PDF thumbnail failed:', err)
    try { unlinkSync(inputPath) } catch {}
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
  try {
    let thumbnail: Buffer | null = null
    if (fileType === 'image') thumbnail = await generateImageThumbnail(buffer)
    else if (fileType === 'video') thumbnail = await generateVideoThumbnail(buffer, file.name)
    else if (fileType === 'document') thumbnail = await generatePdfThumbnail(buffer, file.name)

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
