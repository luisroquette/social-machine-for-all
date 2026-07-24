import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get('text') ?? ''
  const display = text.slice(0, 220)
  const handle = req.nextUrl.searchParams.get('handle') ?? '@your_brand'
  const label = req.nextUrl.searchParams.get('label') ?? 'Your topics'
  const website = req.nextUrl.searchParams.get('website') ?? 'your-company.com'

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0f172a 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
            }}
          >
            💀
          </div>
          <div style={{ color: '#9ca3af', fontSize: '20px', fontWeight: 600 }}>
            {handle}
          </div>
        </div>

        {/* Main text */}
        <div
          style={{
            color: '#f9fafb',
            fontSize: display.length > 120 ? '36px' : '44px',
            fontWeight: 700,
            lineHeight: 1.4,
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            padding: '32px 0',
          }}
        >
          {display}
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #1f2937',
            paddingTop: '24px',
          }}
        >
          <div style={{ color: '#6b7280', fontSize: '18px' }}>
            {label}
          </div>
          <div
            style={{
              background: '#dc2626',
              color: 'white',
              padding: '8px 20px',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            {website}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
