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
  const title = (req.nextUrl.searchParams.get('title') ?? '').toUpperCase().trim() || 'TREND'
  const subtitle = (req.nextUrl.searchParams.get('subtitle') ?? '').trim()
  const style = (req.nextUrl.searchParams.get('style') ?? '').trim()
  const bgUrl = req.nextUrl.searchParams.get('bg') ?? ''
  const font = await fetch(FONT_URL).then((res) => res.arrayBuffer())
  const lines = splitLines(title, 15)

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          position: 'relative',
          background: '#09090b',
          color: '#fff',
          fontFamily: 'Anton',
        }}
      >
        {bgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgUrl}
            alt=""
            width={WIDTH}
            height={HEIGHT}
            style={{
              position: 'absolute',
              inset: 0,
              width: `${WIDTH}px`,
              height: `${HEIGHT}px`,
              objectFit: 'cover',
            }}
          />
        ) : null}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.55) 36%, rgba(0,0,0,0.92) 76%, rgba(0,0,0,0.96) 100%)',
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
            padding: '72px 68px 86px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              padding: '14px 24px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              border: '2px solid rgba(255,255,255,0.18)',
              fontSize: 34,
              letterSpacing: 1,
            }}
          >
            SERIE VIRAL BR
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {lines.map((line, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  fontSize: 120,
                  lineHeight: 0.9,
                  letterSpacing: -1.5,
                  color: index === lines.length - 1 ? '#f97316' : '#ffffff',
                }}
              >
                {line}
              </div>
            ))}
            {subtitle ? (
              <div
                style={{
                  display: 'flex',
                  maxWidth: '84%',
                  fontFamily: 'sans-serif',
                  fontSize: 42,
                  lineHeight: 1.25,
                  color: 'rgba(255,255,255,0.88)',
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              fontFamily: 'sans-serif',
              color: 'rgba(255,255,255,0.78)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', fontSize: 28, letterSpacing: 0.8 }}>COMENTE &quot;PROMPT&quot;</div>
              <div style={{ display: 'flex', fontSize: 24 }}>feito com Claude + pipeline automatizada</div>
            </div>
            {style ? (
              <div style={{ display: 'flex', fontSize: 26, textTransform: 'uppercase' }}>
                {style}
              </div>
            ) : null}
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
