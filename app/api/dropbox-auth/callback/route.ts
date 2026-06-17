import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  const appKey = process.env.DROPBOX_APP_KEY!
  const appSecret = process.env.DROPBOX_APP_SECRET!
  const redirectUri = `${req.nextUrl.origin}/api/dropbox-auth/callback`

  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      client_id: appKey,
      client_secret: appSecret
    })
  })

  const data = await response.json()

  if (data.refresh_token) {
    return NextResponse.json({
      message: '✅ Success! Copy this refresh token to your .env.local as DROPBOX_REFRESH_TOKEN',
      refresh_token: data.refresh_token,
      access_token: data.access_token
    })
  }

  return NextResponse.json({ error: 'Failed', data }, { status: 400 })
}
