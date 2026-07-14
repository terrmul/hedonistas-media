import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge')
  if (!challenge) return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' },
  })
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const secret = process.env.DROPBOX_APP_SECRET!
    const signature = req.headers.get('x-dropbox-signature')
    if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const syncPath = process.env.DROPBOX_SYNC_PATH || ''
    const limit = parseInt(process.env.WEBHOOK_SYNC_LIMIT || '500', 10)
    if (!syncPath) return NextResponse.json({ ok: true, skipped: 'no sync path' })

    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin

    const supabase = getServiceSupabase()

    // resetCursor: false — continue from the saved cursor so we get a delta
    // (additions AND deletions) instead of rescanning the whole folder.
    // First run (no saved cursor) falls back to a full scan automatically.
    const syncRes = await fetch(`${origin}/api/dropbox-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: syncPath, limit, resetCursor: false, tagOnSync: true }),
    })

    // Consume the SSE stream (sync exits early otherwise) and capture the final result
    let added = 0
    let removed = 0
    if (syncRes.body) {
      const reader = syncRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = chunk.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'complete') {
              added = evt.processed || 0
              removed = evt.removed || 0
            }
          } catch {}
        }
      }
    }

    if (added > 0 || removed > 0) {
      await supabase.from('sync_state').upsert({
        key: 'webhook_notification',
        value: JSON.stringify({ count: added, removed, timestamp: new Date().toISOString(), dismissed: false })
      })
    }

    return NextResponse.json({ ok: true, added, removed })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
