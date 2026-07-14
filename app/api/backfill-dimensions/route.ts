import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { getServiceSupabase } from '@/lib/supabase'

// One-off maintenance: fills in width/height for assets missing them, from
// Dropbox media metadata. Powers the aspect-ratio format filter.
// Visit /api/backfill-dimensions in the browser repeatedly until remaining = 0.
// Assets whose files have no media metadata are set to 0x0 (excluded from
// format filters, never retried).

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '200', 10), 500)
    const supabase = getServiceSupabase()
    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const { data: missing, error } = await supabase
      .from('assets')
      .select('id, dropbox_path')
      .is('width', null)
      .not('dropbox_path', 'is', null)
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!missing || missing.length === 0) {
      return NextResponse.json({ message: '✅ Done — all assets have dimensions', updated: 0, noMetadata: 0, remaining: 0 })
    }

    let updated = 0
    let noMetadata = 0
    const BATCH = 10
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH)
      await Promise.all(batch.map(async (asset: any) => {
        try {
          const meta: any = await dbx.filesGetMetadata({ path: asset.dropbox_path, include_media_info: true })
          const dims = meta.result?.media_info?.metadata?.dimensions
          if (dims?.width && dims?.height) {
            await supabase.from('assets').update({ width: dims.width, height: dims.height }).eq('id', asset.id)
            updated++
          } else {
            await supabase.from('assets').update({ width: 0, height: 0 }).eq('id', asset.id)
            noMetadata++
          }
        } catch {
          await supabase.from('assets').update({ width: 0, height: 0 }).eq('id', asset.id)
          noMetadata++
        }
      }))
    }

    const { count } = await supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .is('width', null)

    return NextResponse.json({
      message: (count || 0) > 0 ? `Batch done — refresh this page to continue (${count} left)` : '✅ Done — all assets have dimensions',
      updated,
      noMetadata,
      remaining: count || 0,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
