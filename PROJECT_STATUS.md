# Hedonistas Media Library - Project Status

## Live URLs
- Vercel: https://hedonistas-media-nf7fa5jy6-hedonistasmedia.vercel.app
- GitHub: https://github.com/terrmul/hedonistas-media
- Supabase: https://avrsbwvvrqvcpzzgwzov.supabase.co

## Local Setup
- Project: ~/Documents/hedonistas-media
- Start: npm run dev
- Push: git add -A && git commit -m "message" && git push

## What's Built
- Next.js 16 app with Tailwind
- Supabase database + auth
- Dropbox sync with folder browser
- AI tagging (Claude Sonnet) for JPG/PNG/HEIC/TIFF/PDF/video
- Sharp for image processing
- ffmpeg at /usr/local/bin/ffmpeg for video
- qlmanage for PDF thumbnails (Mac only)
- In-app video player
- User logins with forgot password
- Hedonistas branding (Pacifico font, icon.png)

## In Progress
- (nothing — pick from TODO below)

## Done (earlier sessions)
- Format filter (2026-07-14): aspect-ratio filter in sidebar (landscape,
  portrait, square, 16:9, 9:16, 4:3, 3:4; 3% tolerance). Requires width/height
  columns on assets (SQL below) + /api/backfill-dimensions run until 0.
  Sync stores dimensions on import via Dropbox media metadata.
  SQL: ALTER TABLE assets ADD COLUMN width integer, ADD COLUMN height integer;
- Verified formats (2026-07-14): all 4,816 library files have thumbnails +
  tags. Proven: jpg jpeg png webp heic tif tiff mp4 mov m4v. Dropped unproven
  avi/mkv/webm/wmv from accept lists, dropzone label, and sync.
- Brand color scheme (2026-07-14): light crema theme from brand Pantones,
  implemented entirely as utility-class overrides in app/globals.css (no TSX
  changes). Cream canvas (9185 #EDE1CF), dark olive text (6216), sidebar in
  a slightly darker cream (#E5D7C0), orange actions (158 #E87722),
  raspberry/wine danger (7425/2042), dark gold accents (7551).
  Pacifico font + logo unchanged. Full Pantone→hex table in this session's
  notes; contrast all >= 4.5:1.
- Thumbnails + dupes (2026-07-14): Fixed 140 broken thumbnails. Root causes:
  (1) fix-thumbnails only queried thumbnail_url='' and missed NULLs;
  (2) non-ASCII filenames (e.g. "matatlán") broke BOTH the raw Dropbox-API-Arg
  header (fixed via httpHeaderSafeJson in lib/dropbox.ts) AND Supabase storage
  keys (fixed by sanitizing thumbName in fix-thumbnails + dropbox-sync).
  Failed batches no longer block the queue (excludeIds). GET /api/fix-thumbnails
  = diagnostic report with live Dropbox test. Duplicate-finder delete now writes
  deleted_assets tombstones so autosync doesn't re-import cleared dupes.
- Reconcile route (2026-07-14): /api/reconcile-dropbox removes DB assets whose
  files no longer exist in Dropbox (pre-webhook drift). Dry run by default;
  ?confirm=true deletes rows + thumbnails. Scoped to DROPBOX_SYNC_PATH only.
  RUN: removed 1643 orphans.
- Prune route (2026-07-14): /api/prune-outside-folder removes library entries
  under /hdlf team/ but outside DROPBOX_SYNC_PATH (Dropbox files untouched).
  Dry run by default. RUN: removed 1252 entries (incl. financial/HR docs that
  shouldn't be in the team-browsable library). NOT tombstoned — a manual sync
  of the parent /hdlf team folder would re-import them.
- Date sorting (2026-07-14): REVERTED to original behavior at Terry's request
  — gallery sorts by file_date || created_at in all modes, exactly as before.
  Do not change this again. /api/backfill-file-dates route exists (unused,
  harmless) — fills missing file_date from Dropbox EXIF if ever wanted.
- Dropbox OAuth (permanent token) - DONE, verified 2026-07-14
  - Refresh token in .env.local works (token grant returns 200)
  - All Dropbox routes use getDropboxToken() from lib/dropbox.ts
  - File scopes (files.metadata.read / content.read / content.write) enabled
  - Note: account_info.read scope not enabled — not needed by the app
  - Diagnostic script: node test-dropbox-auth.js


## TODO (updated)

### High priority
- **Admin-only sync** — only terry@hedonistasmezcal.com sees the Choose Folder / sync button; all other logged-in users only see drag and drop
- **Autosync on Dropbox changes** — CODE DONE 2026-07-14: sync route now processes
  Dropbox deletions (removes assets + thumbnails, folder deletes included);
  webhook uses cursor deltas (resetCursor: false) and reports adds + removals;
  UI banner shows both. Sync base folder: /HDLF Team/**Marketing Assets**
  (asterisks are literal; NOT the Dropbox root). DROPBOX_SYNC_PATH set in
  .env.local and Vercel; webhook registered in Dropbox App Console.
  FIXED 2026-07-14 (round 2): webhook was timing out — Dropbox requires a
  response within 10s but we ran the whole sync first, so Dropbox marked the
  endpoint failing and backed off ("worked briefly then stopped"). Now the
  webhook verifies the signature, responds immediately, and runs the sync via
  Next after(), with a sync_state lock + pending-flag re-run to avoid
  concurrent syncs. Sync cursors are now namespaced per path
  (dropbox_sync_cursor::<path>) so manual UI syncs no longer clobber the
  webhook's cursor. Note: first webhook fire after this deploy does one full
  scan (cursor key changed); deletions register from the next change onward.
- **MP4 thumbnails** — video files not pulling thumbnails during sync, needs fix
- **Drag & drop uploads go to Dropbox** — when a user drops a file, upload it to a specific Dropbox folder (e.g. /HDLF Team/Imported Files) instead of just Supabase storage

### Already built, needs registering
- Dropbox webhook route exists at /api/dropbox-webhook — needs to be registered in Dropbox App Console

### Done this session
- Fixed sync stalling: switched to Dropbox native thumbnails (no full file download)
- Added cursor persistence so sync resumes after timeout
- Fixed Supabase 1000 row limit (now 20000)
- Batch size increased to 100, shared link creation removed from import

### Dropbox sync behavior (added this session)
- Re-import deleted files prompt: if a file was previously imported then deleted
  from the library (but still exists in Dropbox), a new sync should detect this
  and ask if these previously-deleted files should be reimported, rather than
  silently skipping or silently reimporting. Requires tracking deleted
  dropbox_paths (a tombstone list) so we can tell "deleted on purpose" apart
  from "never imported".
- Never import duplicates: sync already treats same dropbox_path as same asset;
  confirm this holds even if a file is reachable via two different paths.
- Per-user delete permissions: a user should only be able to delete assets they
  personally imported or uploaded. Requires tracking who imported/uploaded each
  asset (an uploaded_by / imported_by column) and checking it before allowing delete.
- Auto-import new Dropbox files + admin prompt: when new files land in the HDLF
  Team folder, auto-import them in the background via the webhook, then show
  the admin (Terry) a notification next time the page loads: "X new files were
  added from Dropbox" with a review/confirm option.

## TODO -- added this session (tags, permissions, rename, preview)

- Editable tags: currently tags are read-only after AI tagging; add inline
  edit (add/remove individual tags) on the detail view.
- Admin-only sync: only terry@hedonistasmezcal.com should see the Choose
  Folder / sync buttons; other logged-in users should only see drag-and-drop
  upload (still outstanding from earlier sessions).
- Rename files + reflect in Dropbox: investigate whether renaming an asset in
  the library can also rename the actual file in Dropbox via filesMoveV2
  (Dropbox supports rename-in-place this way; app already has
  files.content.write scope). Need to update dropbox_path in Supabase to
  match after a successful rename so future syncs/links don't break.
- Per-user delete permissions, with Terry as full admin: a user should only
  be able to delete assets they personally imported/uploaded; Terry retains
  100% delete access regardless of who uploaded what. Requires an
  uploaded_by column on assets populated at import/upload time, checked
  before allowing delete, with an admin bypass for Terry.
- Full-page preview modal instead of sidebar: replace the current side panel
  preview with a large centered popup showing the image at a bigger, clearer
  size. Use the existing thumbnail_url (no full-file download) for the large
  view. Include all tags, description, and action buttons (download, open in
  Dropbox, delete, etc.) in the popup.

## Video tagging upgrade (done this session)

- Built multi-frame video analysis: extracts 5 evenly-spaced frames per video
  via ffmpeg-static + sends all 5 in one Claude Haiku 4.5 call so it can
  synthesize a single coherent tag set/description across the whole clip
  (previously only analyzed a single Dropbox-generated thumbnail frame).
- Switched video tagging specifically to Haiku 4.5 (cheaper than Sonnet,
  roughly $2.40 vs $7.20 for the full ~995-video library at this volume);
  image tagging stays on Sonnet 4.6.
- Ran as a local Node script (not Vercel) because video files are too large
  for serverless limits -- average 98MB, some up to 2.4GB; downloading and
  ffmpeg-processing this much data would blow Vercel's memory/timeout limits.
- Researched managed FFmpeg-as-a-service options (Rendi, RenderIO) for an
  ongoing solution so future video tagging doesn't require a manual local
  script run -- see "Ongoing video pipeline" below.
- Confirmed quality improvement over the single-frame approach: 5-frame
  analysis catches camera movement (e.g. a steadicam pan) and reads specific
  brand names off products in-frame, which a single static frame could not.

## Ongoing video pipeline -- decision made, not yet built

Going forward, new videos added via Dropbox sync should NOT be tagged through
the existing Vercel route (same large-file problem as the backfill). Plan:
integrate a managed FFmpeg API service (Rendi -- free tier covers 50GB/month
processing, takes a URL not a file upload, no server to manage) to extract
frames server-side, then pass those frames to Claude Haiku 4.5 for tagging
from within the Vercel app. Free tier should comfortably cover
ongoing/incremental video additions (a trickle, not bulk) without needing the
local script again. Needs: a Rendi account + API key, a Vercel route that
calls Rendi with the video's Dropbox URL, polls/receives the extracted
frames, then runs the same Haiku tagging logic already built in
app/api/tag-untagged/route.ts.
