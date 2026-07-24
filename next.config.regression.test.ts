import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf-8')

describe('REGRESSÃO: ffmpeg-static ausente no bundle da Vercel (ENOENT em produção)', () => {
  it('inclui o binario do ffmpeg-static no output file tracing das rotas que fazem stitch/QA de video', () => {
    expect(SRC).toMatch(/outputFileTracingIncludes/)
    expect(SRC).toMatch(/"\/api\/cron\/trend-video-animate":\s*\[.*ffmpeg-static/)
    expect(SRC).toMatch(/"\/api\/cron\/trend-video-publish":\s*\[.*ffmpeg-static/)
  })
})
