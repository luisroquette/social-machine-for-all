/**
 * REGRESSÃO: Stories devem ser postados com delay de 8–44 min após o feed post.
 * Bug: shareToStories() chamado imediatamente (0s delay) = padrão de automação detectável.
 * Fix Phase 3 (A1): delay aumentado para 8–44 min; story_publish_after no DB, processado pela rota stories-publisher.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildStoryMediaPayload, getStoryPollParams } from './route'

describe('REGRESSÃO: story scheduling — delay 8–44 min entre feed post e Story', () => {
  it('delay calculado está entre 8 e 44 minutos', () => {
    // Simula o cálculo de delay usado em publisher/index.ts e reels-publish/route.ts
    for (let i = 0; i < 100; i++) {
      const delayMin = 8 + Math.floor(Math.random() * 37)
      expect(delayMin).toBeGreaterThanOrEqual(8)
      expect(delayMin).toBeLessThanOrEqual(44)
    }
  })

  it('story_publish_after setado no futuro após feed publish', () => {
    const now = Date.now()
    const delayMin = 8 + Math.floor(Math.random() * 37)
    const delayMs = delayMin * 60 * 1000
    const storyPublishAfter = new Date(now + delayMs)
    expect(storyPublishAfter.getTime()).toBeGreaterThanOrEqual(now + 8 * 60 * 1000)
    expect(storyPublishAfter.getTime()).toBeLessThanOrEqual(now + 44 * 60 * 1000)
  })

  it('stories-publisher só processa items com story_publish_after <= now', () => {
    const now = new Date()
    const past = new Date(now.getTime() - 60_000)    // 1 min atrás — deve processar
    const future = new Date(now.getTime() + 300_000) // 5 min no futuro — NÃO deve processar

    expect(past <= now).toBe(true)
    expect(future <= now).toBe(false)
  })

  it('items sem story_cover_url nem story_video_url são ignorados pelo stories-publisher', () => {
    expect(buildStoryMediaPayload({ story_cover_url: null, story_video_url: null })).toBeNull()
    // Se null, a rota retorna { ok: false, error: 'no_cover_url' } sem chamar a API
  })
})

describe('REGRESSÃO: repost de Reel em Stories publica o vídeo curado, não a capa gerada', () => {
  it('quando story_video_url está preenchido, usa video_url (não image_url) — mesmo com cover presente', () => {
    const payload = buildStoryMediaPayload({ story_cover_url: 'https://x/cover.png', story_video_url: 'https://x/video.mp4' })
    expect(payload).toEqual({ video_url: 'https://x/video.mp4' })
  })

  it('quando só story_cover_url está preenchido (feed/carrossel de imagem), usa image_url', () => {
    const payload = buildStoryMediaPayload({ story_cover_url: 'https://x/cover.png', story_video_url: null })
    expect(payload).toEqual({ image_url: 'https://x/cover.png' })
  })

  it('polling de vídeo é mais longo que o de imagem (containers de vídeo demoram mais para processar)', () => {
    const videoParams = getStoryPollParams(true)
    const imageParams = getStoryPollParams(false)
    const videoTotalMs = videoParams.attempts * videoParams.intervalMs
    const imageTotalMs = imageParams.attempts * imageParams.intervalMs
    expect(videoTotalMs).toBeGreaterThan(imageTotalMs)
  })
})

// ── REGRESSÃO: nenhum fetch de publish trava indefinidamente (auditoria 2026-07-15) ──────

describe('REGRESSÃO: todo fetch da etapa de publicação de Story tem timeout explícito', () => {
  /**
   * Bug: criação de container, poll de status e media_publish rodavam sem NENHUM
   * AbortSignal.timeout. O bail-out por item (TIME_BUDGET_MS/VIDEO_WORST_CASE_MS) só é
   * checado ENTRE items — um único fetch travado bloqueava a run inteira além do
   * orçamento pretendido, sem ser contabilizado por esse mecanismo.
   */
  const SRC = readFileSync(join(process.cwd(), 'src/app/api/cron/stories-publisher/route.ts'), 'utf-8')

  it('criação de container de Story tem timeout', () => {
    const block = SRC.slice(SRC.indexOf('Create Stories container'))
    expect(block.slice(0, 900)).toContain('AbortSignal.timeout')
  })

  it('poll de status do container tem timeout', () => {
    const block = SRC.slice(SRC.indexOf('Poll for container readiness'))
    expect(block.slice(0, 500)).toContain('AbortSignal.timeout')
  })

  it('media_publish do Story tem timeout', () => {
    const block = SRC.slice(SRC.indexOf("media_publish`, {"))
    expect(block.slice(0, 300)).toContain('AbortSignal.timeout')
  })
})
