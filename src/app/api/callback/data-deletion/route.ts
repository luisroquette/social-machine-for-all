import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

/**
 * Meta Data Deletion Callback (required for Facebook/Instagram apps).
 *
 * When a user requests deletion of their data from Facebook settings,
 * Meta sends a signed_request to this endpoint.
 *
 * Register in Meta for Developers:
 *   App Settings → Basic → Data Deletion Request URL
 *   → https://socialmachine.ia.br/api/callback/data-deletion
 *
 * Response must be JSON with { url, confirmation_code }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.formData()
    const signedRequest = body.get('signed_request') as string | null

    if (!signedRequest) {
      return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 })
    }

    // Verify signature
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET || ''
    const [encodedSig, payload] = signedRequest.split('.')

    if (appSecret) {
      const expectedSig = createHmac('sha256', appSecret)
        .update(payload)
        .digest('base64url')
      if (encodedSig !== expectedSig) {
        console.warn('[data-deletion] Invalid signature — ignoring request')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
      }
    }

    // Decode payload
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const userId = decoded.user_id ?? 'unknown'
    const confirmationCode = `del_${userId}_${Date.now()}`

    console.log(`[data-deletion] Request received for user ${userId} — confirmation: ${confirmationCode}`)

    // This app only holds OAuth tokens for the Brand account.
    // There is no personal user data to delete — tokens are managed by the account owner.

    return NextResponse.json({
      url: `https://socialmachine.ia.br/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    })
  } catch (err) {
    console.error('[data-deletion] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Some Meta clients may check via GET
export async function GET() {
  return NextResponse.json({ status: 'Data Deletion endpoint active' })
}
