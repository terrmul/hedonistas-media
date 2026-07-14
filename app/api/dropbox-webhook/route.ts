import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { getServiceSupabase } from '@/lib/supabase'

const LOCK_KEY = 'webhook_lock'
const PENDING_KEY = 'webhook_pending'
const LOCK_STALE_MS = 10 * 60 * 1000 // consider a lock dead after 10 minutes

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge')
  if (!challenge) return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' },
  })
}

async function runSync(origin: string, supabase: any): Promise<{ added: number; removed: number }> {
  const syncPath = process.env.DROPBOX_SYNC_PATH || ''
  const limit = parseInt(process.env.WEBHOOK_SYNC_LIMIT || '500', 10)

  // resetCursor: false — continue from the saved cursor so we get a delta
  // (additions AND deletions). First run (no cursor) does a full scan.
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
  return { added, removed }
}

export async function POST(req: NextRequest) {
  // 1. Verify the request really came from Dropbox
  const rawBody = await req.text()
  const secret = process.env.DROPBOX_APP_SECRET!
  const signature = req.headers.get('x-dropbox-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  if (!process.env.DROPBOX_SYNC_PATH) {
    return NextResponse.json({ ok: true, skipped: 'no sync path' })
  }

  const origin = req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin

  // 2. Do the actual sync AFTER responding — Dropbox requires a response
  //    within 10 seconds or it marks the webhook as failing and backs off.
  after(async () => {
    const supabase = getServiceSupabase()
    try {
      // Simple lock so overlapping notifications don't run concurrent syncs.
      // If a sync is already running, flag that another pass is needed.
      const { data: lock } = await supabase.from('sync_state').select('value').eq('key', LOCK_KEY).single()
      const lockTime = lock?.value ? Date.parse(lock.value) : 0
      if (lockTime && Date.now() - lockTime < LOCK_STALE_MS) {
        await supabase.from('sync_state').upsert({ key: PENDING_KEY, value: 'true' })
        return
      }
      await supabase.from('sync_state').upsert({ key: LOCK_KEY, value: new Date().toISOString() })

      let totalAdded = 0
      let totalRemoved = 0
      // Run, then re-run once per pending flag (changes that arrived mid-sync)
      for (let pass = 0; pass < 5; pass++) {
        const { added, removed } = await runSync(origin, supabase)
        totalAdded += added
        totalRemoved += removed
        const { data: pending } = await supabase.from('sync_state').select('value').eq('key', PENDING_KEY).single()
        if (pending?.value !== 'true') break
        await supabase.from('sync_state').delete().eq('key', PENDING_KEY)
      }

      if (totalAdded > 0 || totalRemoved > 0) {
        await supabase.from('sync_state').upsert({
          key: 'webhook_notification',
          value: JSON.stringify({ count: totalAdded, removed: totalRemoved, timestamp: new Date().toISOString(), dismissed: false })
        })
      }
    } catch (err) {
      console.error('Webhook background sync error:', err)
    } finally {
      await supabase.from('sync_state').delete().eq('key', LOCK_KEY)
    }
  })

  // 3. Respond to Dropbox immediately
  return NextResponse.json({ ok: true })
}
