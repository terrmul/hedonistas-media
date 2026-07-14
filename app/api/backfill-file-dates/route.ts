import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { getServiceSupabase } from '@/lib/supabase'

// One-off maintenance route: fills in file_date for assets that don't have one.
// Uses the photo/video's actual capture time (EXIF, via Dropbox media_info)
// when available, otherwise the file's modified date.
// Visit /api/backfill-file-dates in the browser repeatedly until remaining = 0.

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '200', 10), 500)
    const supabase = getServiceSupabase()
    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const { data: missing, error } = await supabase
      .from('assets')
      .select('id, dropbox_path')
      .is('file_date', null)
      .not('dropbox_path', 'is', null)
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!missing || missing.length === 0) {
      return NextResponse.json({ message: '✅ Done — all assets have a file date', updated: 0, failed: 0, remaining: 0 })
    }

    let updated = 0
    let failed = 0

    // Process in small parallel batches to stay fast but polite to the API
    const BATCH = 10
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH)
      await Promise.all(batch.map(async (asset: any) => {
        try {
          const meta: any = await dbx.filesGetMetadata({
            path: asset.dropbox_path,
            include_media_info: true,
          })
          const m = meta.result
          const fileDate =
            m?.media_info?.metadata?.time_taken || // actual capture time (photos/videos)
            m?.client_modified ||
            m?.server_modified ||
            null
          if (fileDate) {
            const { error: upErr } = await supabase.from('assets').update({ file_date: fileDate }).eq('id', asset.id)
            if (upErr) { failed++ } else { updated++ }
          } else {
            failed++
          }
        } catch {
          // File may have been deleted/moved in Dropbox — mark with import date
          // so it stops showing up as "missing" on every run
          const { data: row } = await supabase.from('assets').select('created_at').eq('id', asset.id).single()
          await supabase.from('assets').update({ file_date: row?.created_at || new Date().toISOString() }).eq('id', asset.id)
          failed++
        }
      }))
    }

    const { count } = await supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .is('file_date', null)

    return NextResponse.json({
      message: (count || 0) > 0 ? `Batch done — refresh this page to continue (${count} left)` : '✅ Done — all assets have a file date',
      updated,
      failed,
      remaining: count || 0,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
