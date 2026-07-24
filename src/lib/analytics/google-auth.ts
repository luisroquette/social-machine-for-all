/**
 * Google OAuth2 token management.
 * Uses a refresh token to get short-lived access tokens.
 * Env vars:
 * - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 * - or YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN
 */

let cachedToken: { token: string; expiresAt: number } | null = null

function resolveGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN

  return { clientId, clientSecret, refreshToken }
}

export async function getGoogleAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const { clientId, clientSecret, refreshToken } = resolveGoogleOAuthConfig()

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google OAuth nao configurado. Adicione GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN ou YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN no Vercel.'
    )
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[google-auth] Token refresh failed (${res.status}): ${err.slice(0, 300)}`)
    console.error(`[google-auth] Client ID starts with: ${clientId.slice(0, 15)}...`)
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }

  return cachedToken.token
}

export function isGoogleConfigured(): boolean {
  const { clientId, clientSecret, refreshToken } = resolveGoogleOAuthConfig()
  return !!(clientId && clientSecret && refreshToken)
}
