import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge')
  if (!challenge) {
    return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
  }
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
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
    }
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const syncPath = process.env.DROPBOX_SYNC_PATH || ''
    const limit = parseInt(process.env.WEBHOOK_SYNC_LIMIT || '50', 10)

    if (!syncPath) {
      return NextResponse.json({ ok: true, skipped: 'no sync path configured' })
    }

    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin

    ;(async () => {
      try {
        const supabase = getServiceSupabase()
        const beforeCount = await supabase.from('assets').select('id', { count: 'exact', head: true })
        const before = beforeCount.count || 0

        await fetch(`${origin}/api/dropbox-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: syncPath, limit, resetCursor: true }),
        })

        const afterCount = await supabase.from('assets').select('id', { count: 'exact', head: true })
        const after = afterCount.count || 0
        const newFiles = Math.max(0, after - before)

        if (newFiles > 0) {
          await supabase.from('sync_state').upsert({
            key: 'webhook_notification',
            value: JSON.stringify({
              count: newFiles,
              timestamp: new Date().toISOString(),
              dismissed: false
            })
          })
        }
      } catch (err) {
        console.error('Webhook background sync failed:', err)
      }
    })()

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
