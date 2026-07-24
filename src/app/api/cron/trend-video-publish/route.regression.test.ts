import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-video-publish/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-video-publish', () => {
  it('usa credenciais do workspace em vez de InstagramClient.fromEnv()', () => {
    expect(SRC).toMatch(/getInstagramCredentials\(WORKSPACE_ID\)/)
    expect(SRC).toMatch(/InstagramClient\.fromWorkspace\(igCreds\)/)
    expect(SRC).not.toMatch(/InstagramClient\.fromEnv\(\)/)
  })

  it('publica trend video como carousel misto de 3 paginas', () => {
    expect(SRC).toMatch(/publishMixedCarousel\(caption,\s*\[/)
    expect(SRC).toMatch(/\{\s*type:\s*'image',\s*url:\s*coverUrl/)
    expect(SRC).toMatch(/\{\s*type:\s*'video',\s*url:\s*videoUrl\s*\}/)
    expect(SRC).toMatch(/generateTrendCarouselEndcard\(/)
    expect(SRC).toMatch(/target_format:\s*'carousel'/)
  })
})
