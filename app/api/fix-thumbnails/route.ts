import { NextRequest, NextResponse } from 'next/server'
import { getDropboxToken } from '@/lib/dropbox'
import { supabase } from '@/lib/supabase'

async function getDropboxThumbnail(token: string, filePath: string): Promise<Buffer | null> {
  try {
    const r = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({
          resource: { '.tag': 'path', path: filePath },
          format: { '.tag': 'jpeg' },
          size: { '.tag': 'w640h480' },
          mode: { '.tag': 'fitone_bestfit' }
        }),
        'Content-Type': 'application/octet-stream'
      }
    })
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    const buf = Buffer.from(ab)
    return buf.length > 100 ? buf : null
  } catch {
    return null
  }
}

async function downloadAndThumb(token: string, filePath: string): Promise<Buffer | null> {
  try {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: filePath })
      }
    })
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    const buf = Buffer.from(ab)
    const sharp = (await import('sharp')).default
    return await sharp(buf, { failOn: 'none' }).rotate().resize(640, 480, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
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

export async function POST(req: NextRequest) {
  try {
    const { limit = 30 } = await req.json().catch(() => ({}))
    const token = await getDropboxToken()

    const { data: assets, error } = await supabase
      .from('assets')
      .select('id, name, type, dropbox_path')
      .eq('thumbnail_url', '')
      .limit(limit)

    if (error) throw error
    if (!assets || assets.length === 0) {
      return NextResponse.json({ processed: 0, failed: 0, remaining: 0, done: true })
    }

    let processed = 0
    let failed = 0

    for (const a of assets) {
      try {
        let thumb = await getDropboxThumbnail(token, a.dropbox_path)
        if (!thumb && a.type === 'image') {
          thumb = await downloadAndThumb(token, a.dropbox_path)
        }
        if (thumb) {
          const url = await uploadThumbnail(thumb, a.name)
          if (url) {
            await supabase.from('assets').update({ thumbnail_url: url }).eq('id', a.id)
            processed++
            continue
          }
        }
        failed++
      } catch (err) {
        console.error('Thumbnail retry failed for', a.name, err)
        failed++
      }
    }

    const { count: remaining } = await supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('thumbnail_url', '')

    return NextResponse.json({ processed, failed, remaining: remaining || 0, done: (remaining || 0) === 0 })
  } catch (err) {
    console.error('Fix thumbnails error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
