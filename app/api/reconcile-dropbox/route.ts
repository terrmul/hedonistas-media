import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { getServiceSupabase } from '@/lib/supabase'

// One-time reconcile: finds assets in the database whose files no longer
// exist in Dropbox (deleted/moved before deletion tracking went live).
//
//   GET /api/reconcile-dropbox                → DRY RUN: reports what would be removed
//   GET /api/reconcile-dropbox?confirm=true   → actually removes them (rows + thumbnails)
//
// Only assets under DROPBOX_SYNC_PATH are considered — drag-and-drop uploads
// that only live in Supabase are never touched.

export async function GET(req: NextRequest) {
  try {
    const confirm = req.nextUrl.searchParams.get('confirm') === 'true'
    const basePath = (process.env.DROPBOX_SYNC_PATH || '').toLowerCase()
    if (!basePath) return NextResponse.json({ error: 'DROPBOX_SYNC_PATH not set' }, { status: 400 })

    const supabase = getServiceSupabase()
    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    // 1. List EVERY file currently in Dropbox under the sync folder
    const dropboxPaths = new Set<string>()
    let response = await dbx.filesListFolder({ path: basePath, recursive: true, limit: 2000 })
    for (const e of response.result.entries) {
      if ((e as any)['.tag'] === 'file' && e.path_lower) dropboxPaths.add(e.path_lower)
    }
    while (response.result.has_more) {
      response = await dbx.filesListFolderContinue({ cursor: response.result.cursor })
      for (const e of response.result.entries) {
        if ((e as any)['.tag'] === 'file' && e.path_lower) dropboxPaths.add(e.path_lower)
      }
    }

    // 2. Load all assets that claim to live under the sync folder
    const { data: assets, error } = await supabase
      .from('assets')
      .select('id, name, dropbox_path, thumbnail_url')
      .not('dropbox_path', 'is', null)
      .limit(25000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 3. Orphans = in the database but not in Dropbox
    const orphans = (assets || []).filter(a =>
      a.dropbox_path &&
      a.dropbox_path.toLowerCase().startsWith(basePath) &&
      !dropboxPaths.has(a.dropbox_path.toLowerCase())
    )

    if (!confirm) {
      return NextResponse.json({
        mode: 'DRY RUN — nothing was deleted',
        filesInDropbox: dropboxPaths.size,
        assetsInDatabase: (assets || []).length,
        orphansFound: orphans.length,
        sample: orphans.slice(0, 30).map(a => a.dropbox_path),
        next: orphans.length > 0
          ? 'If this list looks right, visit /api/reconcile-dropbox?confirm=true to remove them'
          : 'Database and Dropbox are in sync — nothing to do',
      })
    }

    // 4. Confirmed: remove thumbnails from storage, then the rows
    let removed = 0
    const BATCH = 100
    for (let i = 0; i < orphans.length; i += BATCH) {
      const batch = orphans.slice(i, i + BATCH)
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
      orphansFound: orphans.length,
      removed,
      message: `✅ Removed ${removed} asset(s) no longer in Dropbox`,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
