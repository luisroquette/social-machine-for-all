import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

const WIDTH = 1080
const HEIGHT = 1920
const FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf'

function splitLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
  }

  if (current) lines.push(current)
  return lines.slice(0, 4)
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '@ai_br_videos').trim()
  const keyword = (req.nextUrl.searchParams.get('keyword') ?? 'PROMPT').trim().toUpperCase()
  const title = (req.nextUrl.searchParams.get('title') ?? 'CURTIU O VIDEO?').trim().toUpperCase()
  const subtitle = (req.nextUrl.searchParams.get('subtitle') ?? 'Segue o perfil para aprender IA e videos virais todos os dias.').trim()
  const font = await fetch(FONT_URL).then((res) => res.arrayBuffer())
  const lines = splitLines(title, 14)

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          position: 'relative',
          background: 'radial-gradient(circle at top, #fb923c 0%, #ea580c 28%, #18181b 72%, #09090b 100%)',
          color: '#fff',
          fontFamily: 'Anton',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.16) 25%, rgba(0,0,0,0.62) 70%, rgba(0,0,0,0.92) 100%)',
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: '74px 68px 88px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              padding: '14px 24px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.14)',
              border: '2px solid rgba(255,255,255,0.18)',
              fontSize: 34,
              letterSpacing: 1,
            }}
          >
            GIVEAWAY LIBERADO
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {lines.map((line, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  fontSize: 118,
                  lineHeight: 0.9,
                  letterSpacing: -1.5,
                  color: index === lines.length - 1 ? '#fdba74' : '#ffffff',
                }}
              >
                {line}
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                maxWidth: '84%',
                fontFamily: 'sans-serif',
                fontSize: 42,
                lineHeight: 1.24,
                color: 'rgba(255,255,255,0.9)',
              }}
            >
              {subtitle}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              fontFamily: 'sans-serif',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 46,
                fontWeight: 700,
                color: '#fff7ed',
              }}
            >
              Siga {handle}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 32,
                color: 'rgba(255,255,255,0.84)',
              }}
            >
              Comente ou mande {keyword} na DM para receber a receita completa.
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: 'Anton', data: font, style: 'normal' }],
    },
  )
}
