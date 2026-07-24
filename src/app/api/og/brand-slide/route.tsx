import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Canvas ────────────────────────────────────────────────────────────────────
const WIDTH  = 1080
const HEIGHT = 1440  // 3:4 portrait — alinha exatamente com a grade do IG (3:4 desde 2025; API aceita, verificado 07/07/2026)
const PAD    = 64

// ── Brand Assets ─────────────────────────────────────────────────────────────
const brand_LOGO_URL = 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/brand-mob/brand/logo.png'

// ── Brand Colors — Brand (from brand.com.br globals.css) ───────────────
const VIOLET   = '#8B35FF'  // hsl(267 100% 65%) — brand-violet
const LAVENDER = '#C4A1FF'  // hsl(263 100% 83%) — brand-lavender
const GOLD     = '#E8B84B'  // hsl(43 70% 69%)   — brand-gold
const BG_BASE  = '#070609'  // hsl(260 50% 3%)   — brand-void

// ── Fonts ─────────────────────────────────────────────────────────────────────
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

  const type        = (sp.get('type') ?? 'content') as 'cover' | 'content' | 'cta'
  const headline    = (sp.get('headline') ?? '').toUpperCase()
  const body        = sp.get('body')    ?? ''
  const context     = sp.get('context') ?? ''
  const kpi         = sp.get('kpi')     ?? ''
  const bgUrl       = sp.get('bg')      ?? ''
  const slideNum    = sp.get('slide_num')    ?? '1'
  const totalSlides = sp.get('total_slides') ?? '1'
  const logoUrl     = sp.get('logo')    ?? ''
  const brandName   = sp.get('brand')   ?? ''
  const eyebrow     = (sp.get('eyebrow') ?? 'EV · B2B').toUpperCase()

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
    poppinsData   = await r1.arrayBuffer()
    jetbrainsData = await r2.arrayBuffer()
  } catch (err) {
    return new Response(`Font load error: ${err instanceof Error ? err.message : err}`, { status: 500 })
  }

  // ── Gradient: stronger for content/cta slides (no heavy photo) ───────────
  const gradientCover =
    'linear-gradient(180deg,' +
    'rgba(0,0,0,0.20) 0%,' +
    'rgba(0,0,0,0.05) 15%,' +
    'rgba(0,0,0,0.50) 42%,' +
    'rgba(0,0,0,0.82) 62%,' +
    'rgba(10,10,10,0.96) 78%,' +
    'rgba(10,10,10,1.00) 100%)'

  const gradientContent =
    'linear-gradient(180deg,' +
    'rgba(10,10,10,0.85) 0%,' +
    'rgba(10,10,10,0.60) 30%,' +
    'rgba(10,10,10,0.90) 70%,' +
    'rgba(10,10,10,1.00) 100%)'

  const gradient = type === 'cover' ? gradientCover : gradientContent

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
        {/* ── Background photo (all types can receive bg URL) ──────────── */}
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

        {/* ── Gradient overlay ─────────────────────────────────────────── */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0,
            width: `${WIDTH}px`, height: `${HEIGHT}px`,
            background: gradient,
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
              brand MOB
            </span>
          </div>
          {/* Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand_LOGO_URL}
            width={72} height={72}
            style={{ width: '72px', height: '72px', objectFit: 'contain' }}
          />
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

        {/* ── Brand logo badge — above slide indicator, bottom left ────── */}
        {logoUrl && brandName && (
          <div
            style={{
              position: 'absolute', bottom: 96, left: PAD,
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

        {/* ── Slide indicator — bottom left ────────────────────────────── */}
        <div
          style={{
            position: 'absolute', bottom: 38, left: PAD,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ fontSize: 24, color: 'rgba(255,255,255,0.50)', fontWeight: 800, letterSpacing: 1 }}>
            {slideNum} / {totalSlides}
          </span>
          {/* progress dots */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
            {Array.from({ length: parseInt(totalSlides) }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: i + 1 === parseInt(slideNum) ? 20 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i + 1 === parseInt(slideNum) ? VIOLET : 'rgba(255,255,255,0.30)',
                  display: 'flex',
                }}
              />
            ))}
          </div>
        </div>

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

        {/* ══════════════════════════════════════════════════════════════════
            COVER — identical to brand-post + slide indicator
        ══════════════════════════════════════════════════════════════════ */}
        {type === 'cover' && (
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

            {kpi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
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
        )}

        {/* ══════════════════════════════════════════════════════════════════
            CONTENT — dark bg, headline ~100px, body text ~42px
        ══════════════════════════════════════════════════════════════════ */}
        {type === 'content' && (
          <div
            style={{
              position: 'absolute',
              top: 0, bottom: 0,
              left: PAD, right: PAD,
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center',
              gap: 28,
            }}
          >
            {/* Green accent bar + headline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 6, height: 80, background: VIOLET, borderRadius: 3, display: 'flex', flexShrink: 0 }} />
              <div
                style={{
                  fontSize: 100,
                  fontWeight: 800,
                  color: '#FFFFFF',
                  lineHeight: 0.9,
                  letterSpacing: -3,
                }}
              >
                {headline}
              </div>
            </div>

            {/* Body text */}
            {body && (
              <div
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  color: 'rgba(255,255,255,0.80)',
                  lineHeight: 1.3,
                  maxWidth: 900,
                }}
              >
                {body}
              </div>
            )}

            {/* KPI if present */}
            {kpi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
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
        )}

        {/* ══════════════════════════════════════════════════════════════════
            CTA — centered, WhatsApp number in green
        ══════════════════════════════════════════════════════════════════ */}
        {type === 'cta' && (
          <div
            style={{
              position: 'absolute',
              top: 0, bottom: 0,
              left: PAD, right: PAD,
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              gap: 24,
            }}
          >
            {/* Main CTA headline */}
            <div
              style={{
                fontSize: 120,
                fontWeight: 800,
                color: '#FFFFFF',
                lineHeight: 0.88,
                letterSpacing: -4,
              }}
            >
              {headline}
            </div>

            {/* Body (e.g. "com a Brand") */}
            {body && (
              <div
                style={{
                  fontSize: 52,
                  fontWeight: 800,
                  color: 'rgba(255,255,255,0.75)',
                  lineHeight: 1.2,
                  maxWidth: 800,
                }}
              >
                {body}
              </div>
            )}

            {/* WhatsApp CTA button */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                marginTop: 16,
                background: 'rgba(139,53,255,0.15)',
                border: `2px solid ${VIOLET}`,
                borderRadius: 16,
                padding: '20px 36px',
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: VIOLET, display: 'flex' }} />
              <span
                style={{
                  fontSize: 40,
                  fontFamily: 'JetBrains',
                  fontWeight: 700,
                  color: LAVENDER,
                  letterSpacing: 0.5,
                }}
              >
                wa.me/5531982578063
              </span>
            </div>
          </div>
        )}
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Poppins',    data: poppinsData,    weight: 800, style: 'normal' },
        { name: 'JetBrains', data: jetbrainsData,  weight: 700, style: 'normal' },
      ],
    },
  )
  } catch (err) {
    return new Response(`ImageResponse error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 })
  }
}
