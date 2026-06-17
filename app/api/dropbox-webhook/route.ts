/**
 * Dropbox webhook endpoint
 *
 * GET  — Dropbox ownership verification (one-time handshake)
 * POST — Dropbox change notification; triggers a background sync
 *
 * Setup:
 *  1. In the Dropbox App Console → Webhooks, add:
 *       https://<your-vercel-domain>/api/dropbox-webhook
 *  2. Add DROPBOX_WEBHOOK_SECRET to .env.local / Vercel env vars.
 *     (Set it to any long random string — you'll paste it nowhere else,
 *      Dropbox doesn't use it. It's just for your own HMAC verification.)
 *  3. Add DROPBOX_SYNC_PATH to .env.local — the Dropbox folder to watch, e.g. /Hedonistas
 *  4. Add WEBHOOK_SYNC_LIMIT (optional, default 50) to cap files per trigger.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ── Dropbox verification handshake ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge')
  if (!challenge) {
    return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
  }
  // Echo the challenge back as plain text — required by Dropbox
  return new NextResponse(challenge, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// ── Change notification ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()

    // Verify the HMAC-SHA256 signature Dropbox sends in X-Dropbox-Signature
    const secret = process.env.DROPBOX_APP_SECRET!
    const signature = req.headers.get('x-dropbox-signature')
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      console.warn('Dropbox webhook: signature mismatch')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    // Dropbox sends { list_folder: { accounts: [...] }, delta: { users: [...] } }
    // We don't need to inspect the payload — any valid notification means "go sync"
    const syncPath = process.env.DROPBOX_SYNC_PATH || ''
    const limit = parseInt(process.env.WEBHOOK_SYNC_LIMIT || '50', 10)

    if (!syncPath) {
      console.warn('Dropbox webhook: DROPBOX_SYNC_PATH not set, skipping sync')
      return NextResponse.json({ ok: true, skipped: 'no sync path configured' })
    }

    // Fire-and-forget: call our own sync endpoint in the background.
    // We do NOT await this — Dropbox expects a fast 200 response.
    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin

    fetch(`${origin}/api/dropbox-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: syncPath, limit }),
    }).catch((err) => console.error('Webhook-triggered sync failed:', err))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
