import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Canvas ──────────────────────────────────────────────────────────────────
const WIDTH  = 1080
const HEIGHT = 1920  // 9:16 Reels
const PAD    = 54
const CONTENT_W = WIDTH - PAD * 2  // 972px

// ── Brand Colors — @inteligencia.artificial.brazil ───────────────────────────
const ACCENT    = '#dc2626'                // red — highlight de marcas/produtos
const BG_BASE   = '#0a0a0a'               // background base fallback
const WATERMARK = 'rgba(255,255,255,0.45)'

// ── Fonts ────────────────────────────────────────────────────────────────────
const ANTON_URL = 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf'

// ── Brand highlights fixas (prefix-match) ────────────────────────────────────
const HIGHLIGHTS = new Set([
  // Big Tech
  'OPENAI','GOOGLE','META','MICROSOFT','NVIDIA','APPLE','AMAZON',
  'ANTHROPIC','DEEPSEEK','TESLA','XAI','MISTRAL','SAMSUNG','IBM',
  'INTEL','AMD','QUALCOMM','TIKTOK','BYTEDANCE','SONY','HUAWEI',
  'SPACEX','UBER','ADOBE','ORACLE','SALESFORCE','PALANTIR',
  // Modelos IA
  'GPT','GEMINI','CLAUDE','LLAMA','GROK','SORA','COPILOT',
  'MIDJOURNEY','PERPLEXITY',
])

// ── Artigos/preposições que nunca ficam sozinhos na última linha ──────────────
const ORPHANS = new Set([
  'DE','E','PARA','COM','QUE','EM','DA','DO','DAS','DOS',
  'NO','NA','NOS','NAS','SE','POR','A','O','AS','OS',
])

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanTitle(t: string): string {
  return t
    .replace(/^(breaking|urgente|exclusivo|último hora):\s*/i, '')
    .trim()
    .toUpperCase()
}

function getTitleFontSize(len: number): number {
  if (len <= 40)  return 108
  if (len <= 70)  return 92
  if (len <= 105) return 76
  return 62
}

function getSubtitleFontSize(len: number): number {
  if (len <= 60)  return 48
  if (len <= 120) return 42
  return 36
}

function wrapLines(text: string, cols: number, max: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (t.length <= cols) {
      cur = t
    } else {
      if (cur) {
        lines.push(cur)
        if (lines.length >= max) break
      }
      cur = w
    }
  }
  if (cur && lines.length < max) lines.push(cur)

  // Orphan prevention
  if (lines.length >= 2) {
    const last = lines[lines.length - 1]
    if (ORPHANS.has(last.trim())) {
      lines[lines.length - 2] += ' ' + last
      lines.pop()
    }
  }
  return lines
}

function isHighlighted(word: string, extras: Set<string>): boolean {
  const key = word.replace(/[^A-Z0-9]/g, '')
  if (!key) return false
  const all = new Set([...HIGHLIGHTS, ...extras])
  return [...all].some(h =>
    key === h ||
    key.startsWith(h) ||
    // h.startsWith(key) só quando key tem ≥3 chars para evitar falsos positivos:
    // "DE" não pode ativar "DEEPSEEK", mas "GPT" pode ativar "GPT4" ou "IAFEZ" pode ativar "IA"
    (key.length >= 3 && h.startsWith(key))
  )
}

// ── Route ────────────────────────────────────────────────────────────────────

// ── Fallback gradient palettes (when no bg image) ───────────────────────────
// Keyed by topic keyword (matches highlightWords). Dark, cinematic, editorial.
const GRADIENT_PALETTES: Record<string, string> = {
  // AI companies
  OPENAI:     'radial-gradient(ellipse 120% 80% at 80% 20%, rgba(16,163,127,0.55) 0%, rgba(0,0,0,0) 60%), radial-gradient(ellipse 80% 120% at 20% 80%, rgba(16,163,127,0.25) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #050f0d 0%, #0a0a0a 100%)',
  ANTHROPIC:  'radial-gradient(ellipse 100% 70% at 75% 15%, rgba(220,120,60,0.50) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 70% 100% at 25% 85%, rgba(180,60,40,0.28) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #0f0805 0%, #0a0a0a 100%)',
  CLAUDE:     'radial-gradient(ellipse 100% 70% at 75% 15%, rgba(220,120,60,0.50) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 70% 100% at 25% 85%, rgba(180,60,40,0.28) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #0f0805 0%, #0a0a0a 100%)',
  GOOGLE:     'radial-gradient(ellipse 110% 80% at 70% 20%, rgba(66,133,244,0.50) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 80% 100% at 30% 80%, rgba(234,67,53,0.22) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #050810 0%, #0a0a0a 100%)',
  GEMINI:     'radial-gradient(ellipse 110% 80% at 70% 20%, rgba(66,133,244,0.50) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 80% 100% at 30% 80%, rgba(234,67,53,0.22) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #050810 0%, #0a0a0a 100%)',
  META:       'radial-gradient(ellipse 120% 80% at 80% 25%, rgba(24,119,242,0.50) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 70% 100% at 20% 75%, rgba(0,180,255,0.20) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #040810 0%, #0a0a0a 100%)',
  MICROSOFT:  'radial-gradient(ellipse 100% 80% at 75% 20%, rgba(0,120,212,0.50) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #040810 0%, #0a0a0a 100%)',
  NVIDIA:     'radial-gradient(ellipse 110% 80% at 80% 20%, rgba(118,185,0,0.55) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 70% 100% at 20% 80%, rgba(80,140,0,0.25) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #040a02 0%, #0a0a0a 100%)',
  APPLE:      'radial-gradient(ellipse 110% 80% at 70% 20%, rgba(160,160,180,0.40) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #08080c 0%, #0a0a0a 100%)',
  TESLA:      'radial-gradient(ellipse 110% 80% at 75% 20%, rgba(204,0,0,0.50) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #0e0303 0%, #0a0a0a 100%)',
  XAI:        'radial-gradient(ellipse 100% 80% at 70% 20%, rgba(120,120,140,0.45) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #080810 0%, #0a0a0a 100%)',
  DEEPSEEK:   'radial-gradient(ellipse 110% 80% at 80% 20%, rgba(0,150,255,0.50) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #030810 0%, #0a0a0a 100%)',
  GPT:        'radial-gradient(ellipse 120% 80% at 80% 20%, rgba(16,163,127,0.55) 0%, rgba(0,0,0,0) 60%), linear-gradient(160deg, #050f0d 0%, #0a0a0a 100%)',
  GROK:       'radial-gradient(ellipse 100% 80% at 70% 20%, rgba(120,120,140,0.45) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #080810 0%, #0a0a0a 100%)',
  LLAMA:      'radial-gradient(ellipse 110% 80% at 75% 20%, rgba(24,119,242,0.50) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #040810 0%, #0a0a0a 100%)',
  MISTRAL:    'radial-gradient(ellipse 110% 80% at 70% 20%, rgba(255,140,0,0.45) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #0e0702 0%, #0a0a0a 100%)',
  PERPLEXITY: 'radial-gradient(ellipse 100% 80% at 75% 20%, rgba(32,178,170,0.50) 0%, rgba(0,0,0,0) 55%), linear-gradient(160deg, #030d0c 0%, #0a0a0a 100%)',
}

const DEFAULT_GRADIENT = 'radial-gradient(ellipse 120% 80% at 75% 15%, rgba(99,102,241,0.45) 0%, rgba(0,0,0,0) 55%), radial-gradient(ellipse 80% 100% at 25% 85%, rgba(139,92,246,0.22) 0%, rgba(0,0,0,0) 50%), linear-gradient(160deg, #06040f 0%, #0a0a0a 100%)'

function getFallbackGradient(highlights: Set<string>): string {
  // Exact match first
  for (const [brand, gradient] of Object.entries(GRADIENT_PALETTES)) {
    if (highlights.has(brand)) return gradient
  }
  // Partial match fallback
  for (const [brand, gradient] of Object.entries(GRADIENT_PALETTES)) {
    for (const h of highlights) {
      if (h.startsWith(brand) || brand.startsWith(h)) return gradient
    }
  }
  return DEFAULT_GRADIENT
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const rawTitle   = sp.get('title')    ?? ''
  const rawHighlight = sp.get('highlight') ?? ''
  const subtitle   = sp.get('subtitle') ?? ''
  const bgUrl      = sp.get('bg')       ?? ''

  const title = cleanTitle(rawTitle)

  // Extra highlights passados dinamicamente (ex: nomes detectados pelo Claude)
  const extras = new Set(
    rawHighlight
      .split(',')
      .map(h => h.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean),
  )

  const fontSize = getTitleFontSize(title.length)
  const cols     = Math.floor(CONTENT_W / (fontSize * 0.50))
  const lines    = wrapLines(title, cols, 6)

  const subFontSize = getSubtitleFontSize(subtitle.length)
  const fallbackGradient = bgUrl ? '' : getFallbackGradient(extras)

  const fontData = await fetch(ANTON_URL).then(r => r.arrayBuffer())

  // Render de uma linha do título com highlight por palavra
  const renderLine = (line: string, key: number) => {
    const words = line.split(' ')
    return (
      <div
        key={key}
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: `${CONTENT_W}px`,
          fontSize,
          fontWeight: 400,
          lineHeight: 0.90,
          letterSpacing: -0.5,
        }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            style={{ color: isHighlighted(w, extras) ? ACCENT : '#FFFFFF' }}
          >
            {w}{i < words.length - 1 ? '\u00A0' : ''}
          </span>
        ))}
      </div>
    )
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: BG_BASE,
          fontFamily: 'Anton',
        }}
      >
        {/* ── Background: photo or themed gradient fallback ──────────────── */}
        {bgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgUrl}
            width={WIDTH}
            height={HEIGHT}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${WIDTH}px`,
              height: `${HEIGHT}px`,
              objectFit: 'cover',
              objectPosition: 'center top',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${WIDTH}px`,
              height: `${HEIGHT}px`,
              background: fallbackGradient,
              display: 'flex',
            }}
          />
        )}

        {/* ── Gradient overlay ───────────────────────────────────────────── */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${WIDTH}px`,
            height: `${HEIGHT}px`,
            background:
              'linear-gradient(180deg,' +
              'rgba(0,0,0,.35) 0%,' +
              'rgba(0,0,0,.08) 18%,' +
              'rgba(0,0,0,.55) 30%,' +
              'rgba(0,0,0,.88) 45%,' +
              'rgba(0,0,0,.82) 62%,' +
              'rgba(0,0,0,.60) 75%,' +
              'rgba(10,10,10,.90) 100%)',
            display: 'flex',
          }}
        />

        {/* ── Logo pill (top-left) ────────────────────────────────────────── */}
        <div
          style={{
            position: 'absolute',
            top: 44,
            left: PAD,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            background: 'rgba(0,0,0,0.55)',
            border: '1.5px solid rgba(220,38,38,0.70)',
            borderRadius: 100,
            padding: '10px 28px 10px 10px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/brand/logo.jpg"
            width={90}
            height={90}
            style={{
              width: '90px',
              height: '90px',
              borderRadius: '50%',
              objectFit: 'cover',
            }}
          />
          <span style={{ fontSize: 28, color: '#FFFFFF', letterSpacing: 2, fontFamily: 'Anton' }}>
            IA BRAZIL
          </span>
        </div>

        {/* ── Categoria pill (top-right) ──────────────────────────────────── */}
        <div
          style={{
            position: 'absolute',
            top: 56,
            right: PAD,
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 100,
            padding: '10px 24px',
          }}
        >
          <span style={{ fontSize: 22, color: '#FFFFFF', letterSpacing: 1 }}>
            IA • TECH
          </span>
        </div>

        {/* ── Bloco de texto — começa em ~54% do canvas (y≈1040/1920) */}
        <div
          style={{
            position: 'absolute',
            top: 1040,
            left: PAD,
            right: PAD,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
          }}
        >
          {/* Título */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0,
              width: `${CONTENT_W}px`,
            }}
          >
            {lines.map((line, i) => renderLine(line, i))}
          </div>

          {/* Subtítulo — nunca truncado */}
          {subtitle && (
            <div
              style={{
                display: 'flex',
                fontSize: subFontSize,
                fontWeight: 400,
                lineHeight: 1.45,
                color: 'rgba(255,255,255,0.88)',
                textAlign: 'center',
                width: `${CONTENT_W}px`,
                justifyContent: 'center',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        {/* ── Watermark (bottom-right) ────────────────────────────────────── */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            right: PAD,
            display: 'flex',
            fontSize: 28,
            color: WATERMARK,
            letterSpacing: 1,
          }}
        >
          @inteligencia.artificial.brazil
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Anton', data: fontData, weight: 400, style: 'normal' },
      ],
    },
  )
}
