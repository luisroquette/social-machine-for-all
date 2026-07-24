import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Moldura 3:4 para assets de marketing pré-feitos (1:1) do @brand ────────
// A grade do IG é 3:4; publicar o asset 1:1 cru faz a grade cortar as laterais.
// Esta rota centraliza o asset num canvas 1080x1440 com o fundo da marca —
// o design original aparece inteiro e a grade fica alinhada (bug de 07/07/2026).
// Sem texto → sem fontes para carregar.
const WIDTH  = 1080
const HEIGHT = 1440
const BG_BASE = '#070609'  // brand-void
const VIOLET  = '#8B35FF'  // brand-violet

export async function GET(req: NextRequest) {
  const img = req.nextUrl.searchParams.get('img') ?? ''
  if (!img) return new Response('missing img param', { status: 400 })

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: WIDTH, height: HEIGHT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
            background: BG_BASE,
          }}
        >
          {/* faixas de respiro com um brilho violeta sutil, na identidade da marca */}
          <div
            style={{
              position: 'absolute', top: 0, left: 0,
              width: `${WIDTH}px`, height: `${HEIGHT}px`,
              background: `radial-gradient(ellipse 90% 45% at 50% 50%, rgba(139,53,255,0.10), transparent 70%)`,
              display: 'flex',
            }}
          />
          {/* asset original inteiro, centralizado (contain — nunca cortar o design) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img}
            width={WIDTH} height={WIDTH}
            style={{ width: `${WIDTH}px`, height: `${WIDTH}px`, objectFit: 'contain' }}
          />
          {/* fio violeta discreto separando as faixas do asset */}
          <div style={{ position: 'absolute', top: (HEIGHT - WIDTH) / 2 - 2, left: 0, width: `${WIDTH}px`, height: 1, background: `rgba(139,53,255,0.25)`, display: 'flex' }} />
          <div style={{ position: 'absolute', bottom: (HEIGHT - WIDTH) / 2 - 2, left: 0, width: `${WIDTH}px`, height: 1, background: `rgba(139,53,255,0.25)`, display: 'flex' }} />
        </div>
      ),
      { width: WIDTH, height: HEIGHT },
    )
  } catch (err) {
    return new Response(`ImageResponse error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 })
  }
}
