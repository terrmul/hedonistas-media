import { NextRequest, NextResponse } from 'next/server'
import { getDropboxToken, httpHeaderSafeJson } from '@/lib/dropbox'
import { getServiceSupabase } from '@/lib/supabase'
const supabase = getServiceSupabase()

async function getDropboxThumbnail(token: string, filePath: string): Promise<Buffer | null> {
  try {
    const r = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': httpHeaderSafeJson({
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
        'Dropbox-API-Arg': httpHeaderSafeJson({ path: filePath })
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

// Matches the UI's definition of "missing": thumbnail_url is NULL or ''
async function getMissingThumbAssets(excludeIds: string[], limit: number) {
  const exclude = (q: any) =>
    excludeIds.length > 0 ? q.not('id', 'in', `(${excludeIds.join(',')})`) : q

  const { data: nulls, error: e1 } = await exclude(
    supabase.from('assets').select('id, name, type, dropbox_path')
      .is('thumbnail_url', null).not('dropbox_path', 'is', null)
  ).limit(limit)
  if (e1) throw e1

  let results = nulls || []
  if (results.length < limit) {
    const { data: empties, error: e2 } = await exclude(
      supabase.from('assets').select('id, name, type, dropbox_path')
        .eq('thumbnail_url', '').not('dropbox_path', 'is', null)
    ).limit(limit - results.length)
    if (e2) throw e2
    results = [...results, ...(empties || [])]
  }
  return results
}

async function countMissingThumbs(): Promise<number> {
  const { count: c1 } = await supabase.from('assets')
    .select('id', { count: 'exact', head: true }).is('thumbnail_url', null)
  const { count: c2 } = await supabase.from('assets')
    .select('id', { count: 'exact', head: true }).eq('thumbnail_url', '')
  return (c1 || 0) + (c2 || 0)
}

// Diagnostic: GET /api/fix-thumbnails shows what's still missing, by extension
export async function GET() {
  try {
    const assets = await getMissingThumbAssets([], 500)
    const byExt: Record<string, number> = {}
    for (const a of assets) {
      const ext = (a.name || '').toLowerCase().slice((a.name || '').lastIndexOf('.')) || '(none)'
      byExt[ext] = (byExt[ext] || 0) + 1
    }
    return NextResponse.json({
      missingThumbnails: assets.length,
      byExtension: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1])),
      sample: assets.slice(0, 20).map((a: any) => ({ name: a.name, type: a.type, path: a.dropbox_path })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { limit = 30, excludeIds = [] } = await req.json().catch(() => ({}))
    const token = await getDropboxToken()

    const assets = await getMissingThumbAssets(excludeIds, limit)
    if (!assets || assets.length === 0) {
      return NextResponse.json({ processed: 0, failed: 0, failedIds: [], remaining: 0, done: true })
    }

    let processed = 0
    let failed = 0
    const failedIds: string[] = []

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
        failedIds.push(a.id)
      } catch (err) {
        console.error('Thumbnail retry failed for', a.name, err)
        failed++
        failedIds.push(a.id)
      }
    }

    const remaining = await countMissingThumbs()

    return NextResponse.json({
      processed,
      failed,
      failedIds,
      remaining,
      done: remaining === 0
    })
  } catch (err) {
    console.error('Fix thumbnails error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
