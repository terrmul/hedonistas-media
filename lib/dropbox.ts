let cachedToken: string | null = null
let tokenExpiry: number = 0

export async function getDropboxToken(): Promise<string> {
  // If we have a cached token that's still valid, use it
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken
  }

  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN
  const appKey = process.env.DROPBOX_APP_KEY!
  const appSecret = process.env.DROPBOX_APP_SECRET!

  // Fall back to static token if no refresh token yet
  if (!refreshToken) {
    return process.env.DROPBOX_ACCESS_TOKEN!
  }

  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret
    })
  })

  const data = await response.json()
  
  if (data.access_token) {
    cachedToken = data.access_token
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000
    return cachedToken!
  }

  throw new Error('Failed to refresh Dropbox token: ' + JSON.stringify(data))
}
