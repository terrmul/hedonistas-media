import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const appKey = process.env.DROPBOX_APP_KEY!
  const redirectUri = `${req.nextUrl.origin}/api/dropbox-auth/callback`
  
  const authUrl = `https://www.dropbox.com/oauth2/authorize?` +
    `client_id=${appKey}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `token_access_type=offline`

  return NextResponse.redirect(authUrl)
}
