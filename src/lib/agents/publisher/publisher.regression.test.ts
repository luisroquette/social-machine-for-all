import { describe, it, expect } from 'vitest'
import { normalizebrandContent } from './index'

/**
 * REGRESSÃO: imagePrompt (camelCase) não era detectado pelo publisher
 *
 * Contexto: O writer gerava `imagePrompt` (camelCase) no JSON de carrossel,
 * mas o publisher checava `image_prompt` (snake_case). Isso fazia
 * `isbrandStructured=false` e o carrossel nunca era publicado.
 * Fix: normalizar no parse — se `imagePrompt` existe e `image_prompt` não,
 * copiar o valor para `image_prompt`.
 */
describe('REGRESSÃO: normalizebrandContent — imagePrompt→image_prompt', () => {
  it('copia imagePrompt para image_prompt quando image_prompt está ausente', () => {
    const raw = { imagePrompt: 'dark EV scene', format: 'carousel', slides: [] }
    const result = normalizebrandContent({ ...raw })
    expect(result.image_prompt).toBe('dark EV scene')
  })

  it('não sobrescreve image_prompt quando já existe', () => {
    const raw = { imagePrompt: 'novo', image_prompt: 'original', format: 'carousel' }
    const result = normalizebrandContent({ ...raw })
    expect(result.image_prompt).toBe('original')
  })

  it('não quebra quando ambos estão ausentes', () => {
    const raw = { format: 'carousel', slides: [] }
    const result = normalizebrandContent({ ...raw })
    expect(result.image_prompt).toBeUndefined()
  })

  it('isbrandStructured seria true após normalização com slides', () => {
    const raw = { imagePrompt: 'dark ev scene', format: 'carousel', slides: [{ type: 'cover', headline: 'TEST' }] }
    const normalized = normalizebrandContent({ ...raw }) as { image_prompt?: string; slides?: unknown[] }
    // Simula a lógica do publisher
    const isbrandStructured = !!(normalized.image_prompt && normalized.slides?.length)
    expect(isbrandStructured).toBe(true)
  })

  it('isbrandStructured seria false sem normalização (o bug original)', () => {
    const raw = { imagePrompt: 'dark ev scene', format: 'carousel', slides: [{ type: 'cover', headline: 'TEST' }] } as Record<string, unknown>
    // Sem normalizar — simula o bug
    const isbrandStructured = !!(raw.image_prompt && Array.isArray(raw.slides) && raw.slides.length)
    expect(isbrandStructured).toBe(false)
  })
})

import { buildStoryQueuePatch, pickStoryCoverUrl } from './index'

/**
 * REGRESSÃO: post/carousel nunca geravam Story — só Reels tinham story_cover_url/
 * story_publish_after gravados (dentro de publishInstagramReel). O cron
 * stories-publisher já é agnóstico de target_format (só filtra por
 * story_publish_after + status='published'), então bastava passar a gravar
 * esses 2 campos também no branch de post/carousel.
 */
describe('REGRESSÃO: Story requeue cobre post/carousel, não só Reels', () => {
  it('buildStoryQueuePatch gera delay entre 8 e 44 minutos', () => {
    const before = Date.now()
    const patch = buildStoryQueuePatch('https://example.com/cover.png')
    const after = Date.now()

    expect(patch.story_cover_url).toBe('https://example.com/cover.png')
    expect(patch.story_delay_minutes).toBeGreaterThanOrEqual(8)
    expect(patch.story_delay_minutes).toBeLessThanOrEqual(44)

    const publishAfterMs = new Date(patch.story_publish_after).getTime()
    expect(publishAfterMs).toBeGreaterThanOrEqual(before + 8 * 60 * 1000)
    expect(publishAfterMs).toBeLessThanOrEqual(after + 44 * 60 * 1000)
  })

  it('pickStoryCoverUrl prefere a capa do carrossel brand quando presente', () => {
    const cover = pickStoryCoverUrl({
      carouselUrls: ['https://example.com/slide-1.png', 'https://example.com/slide-2.png'],
      allImageUrls: ['https://example.com/other.png'],
      imageUrl: 'https://example.com/single.png',
    })
    expect(cover).toBe('https://example.com/slide-1.png')
  })

  it('pickStoryCoverUrl usa a primeira imagem do carrossel genérico quando não é brand', () => {
    const cover = pickStoryCoverUrl({
      carouselUrls: null,
      allImageUrls: ['https://example.com/other-1.png', 'https://example.com/other-2.png'],
      imageUrl: null,
    })
    expect(cover).toBe('https://example.com/other-1.png')
  })

  it('pickStoryCoverUrl cai para a imagem única quando não há carrossel', () => {
    const cover = pickStoryCoverUrl({ carouselUrls: null, allImageUrls: [], imageUrl: 'https://example.com/single.png' })
    expect(cover).toBe('https://example.com/single.png')
  })

  it('pickStoryCoverUrl retorna null quando não há nenhuma imagem disponível', () => {
    const cover = pickStoryCoverUrl({ carouselUrls: null, allImageUrls: [], imageUrl: null })
    expect(cover).toBeNull()
  })
})
