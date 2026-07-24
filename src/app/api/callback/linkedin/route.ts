import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { invalidateCredentialsCache } from '@/lib/settings/load-credentials'

/**
 * LinkedIn OAuth callback.
 * Receives auth code → exchanges for access token → stores in DB.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return renderPage('error', `OAuth Error: ${error} — ${searchParams.get('error_description')}`)
  }

  if (!code) {
    return renderPage('error', 'No authorization code received')
  }

  // Exchange code for access token
  const clientId = process.env.LINKEDIN_CLIENT_ID
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET
  const redirectUri = `${getBaseUrl(request)}/api/callback/linkedin`

  if (!clientId || !clientSecret) {
    return renderPage('error', 'LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET not configured')
  }

  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    const tokenData = await tokenRes.json() as {
      access_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }

    if (!tokenRes.ok || !tokenData.access_token) {
      return renderPage('error', `Token exchange failed: ${tokenData.error_description || tokenData.error || 'unknown'}`)
    }

    // Get LinkedIn profile to confirm identity
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profile = await profileRes.json() as { name?: string; email?: string }

    // Store token (update workspace config or env — for now log it securely)
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 5184000) * 1000)

    console.log(`[linkedin] Token obtained for ${profile.name || 'unknown'}. Expires: ${expiresAt.toISOString()}`)

    // Save token to workspaces.platform_credentials JSONB (single-tenant: update first workspace)
    const supabase = getAdminClient()
    const { data: ws } = await supabase
      .from('workspaces')
      .select('id, platform_credentials')
      .eq('active', true)
      .limit(1)
      .single()

    if (ws) {
      const current = (ws.platform_credentials ?? {}) as Record<string, unknown>
      await supabase
        .from('workspaces')
        .update({
          platform_credentials: {
            ...current,
            linkedin: {
              accessToken: tokenData.access_token,
              expiresAt: expiresAt.toISOString(),
              name: profile.name,
              email: profile.email,
            },
          },
        })
        .eq('id', ws.id)
      invalidateCredentialsCache(ws.id)
      console.log(`[linkedin] Token saved to workspaces.platform_credentials for workspace ${ws.id}`)
    } else {
      console.error('[linkedin] No active workspace found — token not persisted')
    }

    return renderPage('success', `LinkedIn conectado! Usuário: ${profile.name || 'unknown'}. Token expira em ${Math.round((tokenData.expires_in || 0) / 86400)} dias.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[linkedin] Token exchange error:', msg)
    return renderPage('error', `Exchange failed: ${msg}`)
  }
}

function getBaseUrl(request: Request): string {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

function renderPage(status: 'success' | 'error', message: string) {
  const color = status === 'success' ? '#0f0' : '#f55'
  const icon = status === 'success' ? '✅' : '❌'
  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;padding:60px;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:80vh">
      <div style="text-align:center;max-width:500px">
        <div style="font-size:48px;margin-bottom:16px">${icon}</div>
        <h2 style="color:${color};margin-bottom:12px">${status === 'success' ? 'LinkedIn Conectado' : 'Erro'}</h2>
        <p style="color:#aaa;line-height:1.6">${message}</p>
        <p style="color:#666;margin-top:24px;font-size:13px">Você pode fechar esta página.</p>
      </div>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
