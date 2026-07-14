// Diagnostic: tests the Dropbox refresh-token flow using values from .env.local
// Run with:  node test-dropbox-auth.js
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const refreshToken = env.DROPBOX_REFRESH_TOKEN;
const appKey = env.DROPBOX_APP_KEY;
const appSecret = env.DROPBOX_APP_SECRET;

async function main() {
  console.log('--- Dropbox OAuth diagnostic ---');
  console.log('App key present:', !!appKey, '| App secret present:', !!appSecret);
  console.log('Refresh token present:', !!refreshToken, refreshToken ? `(starts ${refreshToken.slice(0, 4)}..., ${refreshToken.length} chars)` : '');

  // Test 1: refresh token grant
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken || 'missing',
      client_id: appKey,
      client_secret: appSecret,
    }),
  });
  const body = await res.text();
  console.log('\nTest 1 — refresh token grant');
  console.log('HTTP status:', res.status);
  // Redact the access token if the call succeeded
  console.log('Response:', body.replace(/"access_token": ?"[^"]+"/, '"access_token":"<works — redacted>"').slice(0, 400));

  // Test 2: if we got an access token, try the API calls the app actually uses
  if (res.status === 200) {
    const token = JSON.parse(body).access_token;
    const tests = [
      ['account_info.read', 'https://api.dropboxapi.com/2/users/get_current_account', undefined],
      ['files.metadata.read', 'https://api.dropboxapi.com/2/files/list_folder', { path: '', limit: 1 }],
    ];
    for (const [scope, url, payload] of tests) {
      const api = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      console.log(`\nTest — ${scope}: HTTP ${api.status}`, api.status === 200 ? '✅' : (await api.text()).slice(0, 200));
    }
  } else {
    console.log('\nDiagnosis hints:');
    console.log('- 400 + invalid_grant  => the refresh token itself is bad/expired');
    console.log('- 400 + invalid_client => wrong app key or secret');
    console.log('- 401                  => app key/secret rejected by Dropbox');
  }
}

main().catch(e => console.error('Script error:', e.message));
