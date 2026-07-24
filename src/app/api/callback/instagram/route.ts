import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { invalidateCredentialsCache } from '@/lib/settings/load-credentials'

/**
 * Instagram OAuth callback.
 * Receives auth code → short-lived token → long-lived token (60 days) → saves to DB.
 *
 * Register this redirect URI in Meta App:
 *   https://social-machine-v31.vercel.app/api/callback/instagram
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

  const appId = process.env.INSTAGRAM_APP_ID
  const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET
  const redirectUri = `${getBaseUrl(request)}/api/callback/instagram`

  if (!appId || !appSecret) {
    return renderPage('error', 'INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET not configured')
  }

  try {
    // ── Step 1: Exchange code for short-lived token ──────────────────────────
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    })

    const shortData = await shortRes.json() as {
      access_token?: string
      user_id?: number
      error_type?: string
      error_message?: string
    }

    if (!shortRes.ok || !shortData.access_token) {
      return renderPage('error', `Short-lived token failed: ${shortData.error_message || JSON.stringify(shortData)}`)
    }

    const shortToken = shortData.access_token
    const igUserId = String(shortData.user_id ?? '')

    // ── Step 2: Exchange for long-lived token (60 days) ──────────────────────
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
    )
    const longData = await longRes.json() as {
      access_token?: string
      token_type?: string
      expires_in?: number
      error?: { message?: string }
    }

    if (!longRes.ok || !longData.access_token) {
      return renderPage('error', `Long-lived token failed: ${longData.error?.message || JSON.stringify(longData)}`)
    }

    const longToken = longData.access_token
    const expiresInDays = Math.round((longData.expires_in ?? 5184000) / 86400)
    const expiresAt = new Date(Date.now() + (longData.expires_in ?? 5184000) * 1000).toISOString()

    // ── Step 3: Get IG user info to confirm ──────────────────────────────────
    const meRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}?fields=name,username&access_token=${longToken}`)
    const me = await meRes.json() as { name?: string; username?: string }

    // ── Step 4: Save to workspaces.platform_credentials ──────────────────────
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
            instagram: {
              accessToken: longToken,
              userId: igUserId,
              appId,
              expiresAt,
              username: me.username ?? me.name ?? '',
            },
          },
        })
        .eq('id', ws.id)
      invalidateCredentialsCache(ws.id)
      console.log(`[instagram-callback] Token saved for @${me.username} (userId: ${igUserId}), expires ${expiresAt}`)
    }

    return renderPage(
      'success',
      `Instagram conectado! @${me.username ?? igUserId}.<br>Token válido por ~${expiresInDays} dias (expira ${expiresAt.slice(0, 10)}).<br><br>Salvo no banco de dados — Business Discovery ativo.`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instagram-callback] Error:', msg)
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
        <h2 style="color:${color};margin-bottom:12px">${status === 'success' ? 'Instagram Conectado' : 'Erro'}</h2>
        <p style="color:#aaa;line-height:1.6">${message}</p>
        <p style="color:#666;margin-top:24px;font-size:13px">Você pode fechar esta página.</p>
      </div>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
