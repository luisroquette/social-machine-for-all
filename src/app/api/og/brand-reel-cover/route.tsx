import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Canvas — 9:16 Reels ───────────────────────────────────────────────────────
const WIDTH  = 1080
const HEIGHT = 1920
const PAD    = 72
// A grade do perfil do IG exibe 3:4: de um 1080x1920 ela mostra só o miolo
// y 240→1680. Pills e watermark DEVEM ficar dentro dessa zona ou aparecem
// decepados na grade (bug de 07/07/2026). No player de Reels, a UI cobre o
// topo/rodapé de qualquer forma — recuar os elementos também melhora lá.
const GRID_CROP = 240

// ── Brand Colors — Brand (from brand.com.br globals.css) ───────────────
const VIOLET   = '#8B35FF'  // hsl(267 100% 65%) — brand-violet
const LAVENDER = '#C4A1FF'  // hsl(263 100% 83%) — brand-lavender
const GOLD     = '#E8B84B'  // hsl(43 70% 69%)   — brand-gold
const BG_BASE  = '#070609'  // hsl(260 50% 3%)   — brand-void

// ── Brand Assets ─────────────────────────────────────────────────────────────
const brand_LOGO_URL = 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/brand-mob/brand/logo.png'

// ── Fonts ─────────────────────────────────────────────────────────────────────
const POPPINS_URL   = 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-ExtraBold.ttf'
const JETBRAINS_URL = 'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Bold.ttf'

// ── Hook title sizing — garante que o texto sempre cabe na safe zone ──────────
// hookTitle é sempre uma palavra única. Fórmula: fontSize = AVAILABLE_W / (len × CHAR_RATIO)
// CHAR_RATIO 0.65 = avg Poppins ExtraBold uppercase width/fontSize + margem de segurança
export function hookSize(len: number): number {
  const AVAILABLE_W = WIDTH - 2 * PAD  // 936px
  const CHAR_RATIO  = 0.65             // Poppins ExtraBold uppercase (conservative)
  // Sem piso mínimo — a fórmula é auto-limitante: floor(W/(n×r)) × n × r ≤ W sempre
  return Math.min(220, Math.floor(AVAILABLE_W / Math.max(1, len * CHAR_RATIO)))
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const hookTitle     = (sp.get('hookTitle')     ?? '').toUpperCase()
  const highlightName = sp.get('highlightName')  ?? ''
  const bgUrl         = sp.get('bg')             ?? ''
  const kpi           = sp.get('kpi')            ?? ''

  const hSize = hookSize(hookTitle.length)

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
        {/* ── Background photo ─────────────────────────────────────────── */}
        {bgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgUrl}
            width={WIDTH} height={HEIGHT}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: `${WIDTH}px`, height: `${HEIGHT}px`,
              objectFit: 'cover', objectPosition: 'center top',
            }}
          />
        )}

        {/* ── Gradient — heavy at bottom for text, lighter at top ───────── */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0,
            width: `${WIDTH}px`, height: `${HEIGHT}px`,
            background:
              'linear-gradient(180deg,' +
              'rgba(7,6,9,0.15) 0%,' +
              'rgba(7,6,9,0.05) 10%,' +
              'rgba(7,6,9,0.30) 45%,' +
              'rgba(7,6,9,0.80) 65%,' +
              'rgba(7,6,9,0.96) 80%,' +
              'rgba(7,6,9,1.00) 100%)',
            display: 'flex',
          }}
        />

        {/* ── Brand pill — top left (dentro da zona 3:4 da grade) ───────── */}
        <div
          style={{
            position: 'absolute', top: GRID_CROP + 36, left: PAD,
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'rgba(7,6,9,0.70)',
            border: `1.5px solid rgba(139,53,255,0.55)`,
            borderRadius: 100,
            padding: '10px 28px 10px 10px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand_LOGO_URL}
            width={72} height={72}
            style={{ width: '72px', height: '72px', borderRadius: '50%', objectFit: 'cover' }}
          />
          <span style={{ fontSize: 28, color: '#FFFFFF', letterSpacing: 2, fontWeight: 800 }}>
            brand MOB
          </span>
        </div>

        {/* ── Category pill — top right (dentro da zona 3:4 da grade) ───── */}
        <div
          style={{
            position: 'absolute', top: GRID_CROP + 36, right: PAD,
            display: 'flex', alignItems: 'center',
            background: 'rgba(139,53,255,0.12)',
            border: `1px solid rgba(139,53,255,0.35)`,
            borderRadius: 100,
            padding: '12px 28px',
          }}
        >
          <span style={{ fontSize: 24, color: LAVENDER, letterSpacing: 1, fontWeight: 800 }}>
            EV · B2B
          </span>
        </div>

        {/* ── Violet vertical accent bar (left edge, middle height) ──────── */}
        <div
          style={{
            position: 'absolute',
            left: 0, top: '35%',
            width: 8, height: '30%',
            background: `linear-gradient(180deg, transparent, ${VIOLET}, transparent)`,
            display: 'flex',
          }}
        />

        {/* ── Main content block — vertically centered (safe for all IG crop ratios) */}
        <div
          style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: PAD, right: PAD,
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          {/* Hook title — big impact word */}
          <div
            style={{
              fontSize: hSize,
              fontWeight: 800,
              color: '#FFFFFF',
              lineHeight: 0.88,
              letterSpacing: hookTitle.length <= 8 ? -6 : -2,
              maxWidth: WIDTH - 2 * PAD,
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            {hookTitle}
          </div>

          {/* Highlight name — context line */}
          {highlightName && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                marginTop: 8,
              }}
            >
              <div style={{ width: 5, height: 52, background: VIOLET, borderRadius: 3, display: 'flex', flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 52,
                  fontWeight: 800,
                  color: 'rgba(255,255,255,0.80)',
                  lineHeight: 1.15,
                  maxWidth: 900,
                }}
              >
                {highlightName}
              </span>
            </div>
          )}

          {/* KPI — JetBrains Mono, gold */}
          {kpi && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
              <div style={{ width: 5, height: 46, background: GOLD, borderRadius: 3, display: 'flex', flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 40,
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

        {/* ── Handle watermark — bottom right (dentro da zona 3:4 da grade) */}
        <div
          style={{
            position: 'absolute', bottom: GRID_CROP + 42, right: PAD,
            fontSize: 28, color: 'rgba(255,255,255,0.35)',
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
        { name: 'Poppins',    data: poppinsData,    weight: 800, style: 'normal' },
        { name: 'JetBrains', data: jetbrainsData,  weight: 700, style: 'normal' },
      ],
    },
  )
  } catch (err) {
    return new Response(`ImageResponse error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 })
  }
}
