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
- Dropbox OAuth (permanent token) - PARTIALLY DONE
  - App key and secret added to .env.local
  - Redirect URIs added to Dropbox app
  - Auth routes created: /api/dropbox-auth and /api/dropbox-auth/callback
  - lib/dropbox.ts helper created
  - Need to: visit localhost:3000/api/dropbox-auth to get refresh token
  - Then update all routes to use getDropboxToken() from lib/dropbox.ts
  - Currently getting 401 error on browse - old token expired


## TODO (updated)

### High priority
- **Admin-only sync** — only terry@hedonistasmezcal.com sees the Choose Folder / sync button; all other logged-in users only see drag and drop
- **Autosync on Dropbox changes** — webhook already built, needs to handle both additions AND deletions so database always mirrors HDLF Team folder
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
