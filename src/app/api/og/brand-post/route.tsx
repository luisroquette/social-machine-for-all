import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Canvas ────────────────────────────────────────────────────────────────────
const WIDTH  = 1080
const HEIGHT = 1440  // 3:4 portrait — alinha exatamente com a grade do IG (3:4 desde 2025; API aceita, verificado 07/07/2026)
const PAD    = 64

// ── Brand Assets ─────────────────────────────────────────────────────────────
const BRAND_LOGO_URL = process.env.BRAND_LOGO_URL ?? ''

// ── Brand Colors — Brand (from your-company.example globals.css) ───────────────
const VIOLET   = '#8B35FF'  // hsl(267 100% 65%) — brand-violet
const LAVENDER = '#C4A1FF'  // hsl(263 100% 83%) — brand-lavender
const GOLD     = '#E8B84B'  // hsl(43 70% 69%)   — brand-gold
const BG_BASE  = '#070609'  // hsl(260 50% 3%)   — brand-void

// ── Fonts (Google Fonts static TTF — variable fonts break Satori on Edge) ────
const POPPINS_URL   = 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-ExtraBold.ttf'
const JETBRAINS_URL = 'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Bold.ttf'

// ── Headline sizing ───────────────────────────────────────────────────────────
function headlineSize(len: number): number {
  if (len <= 4)  return 210
  if (len <= 7)  return 180
  if (len <= 12) return 148
  if (len <= 18) return 118
  if (len <= 26) return 96
  return 78
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const headline  = (sp.get('headline') ?? '').toUpperCase()
  const context   = sp.get('context')  ?? ''
  const kpi       = sp.get('kpi')      ?? ''
  const bgUrl     = sp.get('bg')       ?? ''
  const logoUrl   = sp.get('logo')     ?? ''
  const brandName = sp.get('brand')    ?? ''
  const eyebrow   = (sp.get('eyebrow') ?? 'EV · B2B').toUpperCase()

  const hSize = headlineSize(headline.length)

  let poppinsData: ArrayBuffer
  let jetbrainsData: ArrayBuffer
  try {
    const [r1, r2] = await Promise.all([
      fetch(POPPINS_URL),
      fetch(JETBRAINS_URL),
    ])
    if (!r1.ok) return new Response(`Font Poppins failed: ${r1.status}`, { status: 500 })
    if (!r2.ok) return new Response(`Font JetBrains failed: ${r2.status}`, { status: 500 })
    poppinsData  = await r1.arrayBuffer()
    jetbrainsData = await r2.arrayBuffer()
  } catch (err) {
    return new Response(`Font load error: ${err instanceof Error ? err.message : err}`, { status: 500 })
  }

  try { return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH, height: HEIGHT,
          display: 'flex', flexDirection: 'column',
          position: 'relative',
          background: BG_BASE,
          fontFamily: 'Poppins',
        }}
      >
        {/* ── Background photo ────────────────────────────────────────────── */}
        {bgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgUrl}
            width={WIDTH} height={HEIGHT}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: `${WIDTH}px`, height: `${HEIGHT}px`,
              objectFit: 'cover', objectPosition: 'center',
            }}
          />
        )}

        {/* ── Gradient overlay — heavier at bottom for text legibility ──── */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0,
            width: `${WIDTH}px`, height: `${HEIGHT}px`,
            background:
              'linear-gradient(180deg,' +
              'rgba(0,0,0,0.20) 0%,' +
              'rgba(0,0,0,0.05) 15%,' +
              'rgba(0,0,0,0.50) 42%,' +
              'rgba(0,0,0,0.82) 62%,' +
              'rgba(10,10,10,0.96) 78%,' +
              'rgba(10,10,10,1.00) 100%)',
            display: 'flex',
          }}
        />

        {/* ── Brand pill + logo — top left ─────────────────────────────── */}
        <div
          style={{
            position: 'absolute', top: PAD, left: PAD,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
          }}
        >
          {/* Pill */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'rgba(0,0,0,0.65)',
              border: `1.5px solid rgba(139,53,255,0.55)`,
              borderRadius: 100,
              padding: '10px 26px 10px 18px',
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: VIOLET, display: 'flex' }} />
            <span style={{ fontSize: 26, color: '#FFFFFF', letterSpacing: 2, fontWeight: 800 }}>
              YOUR BRAND
            </span>
          </div>
          {BRAND_LOGO_URL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={BRAND_LOGO_URL}
              alt=""
              width={72} height={72}
              style={{ width: '72px', height: '72px', objectFit: 'contain' }}
            />
          )}
        </div>

        {/* ── Category pill — top right ────────────────────────────────── */}
        <div
          style={{
            position: 'absolute', top: PAD, right: PAD,
            display: 'flex', alignItems: 'center',
            background: 'rgba(139,53,255,0.12)',
            border: `1px solid rgba(139,53,255,0.35)`,
            borderRadius: 100,
            padding: '10px 26px',
          }}
        >
          <span style={{ fontSize: 22, color: LAVENDER, letterSpacing: 1, fontWeight: 800 }}>
            {eyebrow}
          </span>
        </div>

        {/* ── Main content block — pinned to bottom ────────────────────── */}
        <div
          style={{
            position: 'absolute',
            bottom: 96,
            left: PAD, right: PAD,
            display: 'flex', flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          {/* Headline — the big impact word */}
          <div
            style={{
              fontSize: hSize,
              fontWeight: 800,
              color: '#FFFFFF',
              lineHeight: 0.88,
              letterSpacing: headline.length <= 8 ? -6 : -2,
            }}
          >
            {headline}
          </div>

          {/* Context — smaller descriptive line */}
          {context && (
            <div
              style={{
                fontSize: 46,
                fontWeight: 800,
                color: 'rgba(255,255,255,0.70)',
                lineHeight: 1.15,
                marginTop: 4,
              }}
            >
              {context}
            </div>
          )}

          {/* KPI data — JetBrains Mono with gold accent bar */}
          {kpi && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                marginTop: 10,
              }}
            >
              <div style={{ width: 5, height: 44, background: GOLD, borderRadius: 3, display: 'flex', flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 38,
                  fontFamily: 'JetBrains',
                  fontWeight: 700,
                  color: GOLD,
                  letterSpacing: -0.5,
                }}
              >
                {kpi}
              </span>
            </div>
          )}
        </div>

        {/* ── Brand logo badge — bottom left (symmetric to @brand) ─── */}
        {logoUrl && brandName && (
          <div
            style={{
              position: 'absolute', bottom: 38, left: PAD,
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(0,0,0,0.65)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 100,
              padding: '6px 18px 6px 8px',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              width={36}
              height={36}
              style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'contain', background: '#FFFFFF' }}
            />
            <span style={{ fontSize: 22, color: 'rgba(255,255,255,0.70)', fontWeight: 800, letterSpacing: 0.5 }}>
              {brandName}
            </span>
          </div>
        )}

        {/* ── Handle watermark — bottom right ─────────────────────────── */}
        <div
          style={{
            position: 'absolute', bottom: 38, right: PAD,
            fontSize: 26, color: 'rgba(255,255,255,0.35)',
            fontWeight: 800, letterSpacing: 1,
          }}
        >
          @brand
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Poppins',     data: poppinsData,    weight: 800, style: 'normal' },
        { name: 'JetBrains',  data: jetbrainsData,  weight: 700, style: 'normal' },
      ],
    },
  )
  } catch (err) {
    return new Response(`ImageResponse error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 })
  }
}
