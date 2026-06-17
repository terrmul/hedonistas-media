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

## TODO
- Fix Dropbox 401 (complete OAuth flow)
- Update all Dropbox routes to use getDropboxToken()
- Dropbox webhook for auto-sync
- Fix video thumbnails on Vercel (ffmpeg)
- Fix PDF thumbnails on Vercel (qlmanage is Mac only)
- Fix HEIC on Vercel

## Tech Stack
- Next.js 16.2.9
- Supabase (db + auth)
- Anthropic Claude Sonnet 4.6
- Sharp 0.33.5
- Dropbox SDK
- ffmpeg at /usr/local/bin/ffmpeg
- Tailwind CSS
- Deployed on Vercel
