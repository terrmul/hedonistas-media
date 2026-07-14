import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'

// Removes library entries whose files live under /hdlf team/ but OUTSIDE the
// sync folder (DROPBOX_SYNC_PATH, i.e. /HDLF Team/**Marketing Assets**).
// Dropbox files themselves are NOT touched — this only cleans the database.
//
//   GET /api/prune-outside-folder                → DRY RUN: shows what would be removed
//   GET /api/prune-outside-folder?confirm=true   → actually removes rows + thumbnails

const PARENT = '/hdlf team/'

export async function GET(req: NextRequest) {
  try {
    const confirm = req.nextUrl.searchParams.get('confirm') === 'true'
    const keepPath = (process.env.DROPBOX_SYNC_PATH || '').toLowerCase()
    if (!keepPath) return NextResponse.json({ error: 'DROPBOX_SYNC_PATH not set' }, { status: 400 })

    const supabase = getServiceSupabase()
    const { data: assets, error } = await supabase
      .from('assets')
      .select('id, dropbox_path, thumbnail_url')
      .not('dropbox_path', 'is', null)
      .limit(25000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const toRemove = (assets || []).filter(a => {
      const p = (a.dropbox_path || '').toLowerCase()
      return p.startsWith(PARENT) && !p.startsWith(keepPath + '/') && p !== keepPath
    })

    if (!confirm) {
      return NextResponse.json({
        mode: 'DRY RUN — nothing was deleted',
        keeping: `everything under ${keepPath}`,
        removing: `assets under ${PARENT} but outside the folder above`,
        wouldRemove: toRemove.length,
        sample: toRemove.slice(0, 30).map(a => a.dropbox_path),
        next: toRemove.length > 0
          ? 'If this list looks right, visit /api/prune-outside-folder?confirm=true'
          : 'Nothing outside the sync folder — no cleanup needed',
      })
    }

    let removed = 0
    const BATCH = 100
    for (let i = 0; i < toRemove.length; i += BATCH) {
      const batch = toRemove.slice(i, i + BATCH)
      const thumbNames = batch
        .map(a => a.thumbnail_url?.split('/thumbnails/')[1])
        .filter(Boolean) as string[]
      if (thumbNames.length > 0) {
        await supabase.storage.from('thumbnails').remove(thumbNames)
      }
      const { error: delErr } = await supabase.from('assets').delete().in('id', batch.map(a => a.id))
      if (!delErr) removed += batch.length
    }

    return NextResponse.json({
      mode: 'CONFIRMED',
      removed,
      message: `✅ Removed ${removed} library entr${removed === 1 ? 'y' : 'ies'} outside ${keepPath} (Dropbox files untouched)`,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
