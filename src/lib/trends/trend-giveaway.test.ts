import { describe, expect, it } from 'vitest'
import { buildTrendGiveawayPackage, extractGiveawayKeyword } from './trend-giveaway'

describe('trend giveaway helpers', () => {
  it('extrai keyword do CTA entre aspas', () => {
    expect(extractGiveawayKeyword('Comente aqui "PROMPT" para receber.')).toBe('PROMPT')
  })

  it('monta giveaway package com assets e delivery', () => {
    const pack = buildTrendGiveawayPackage({
      jobId: 'job-1',
      style: 'anime',
      angle: 'mini filme',
      hookTitle: 'POR QUE ISSO BOMBOU',
      coverTitle: 'PORTUGAL',
      caption: 'Legenda',
      ctaText: 'Comente "PROMPT".',
      imagePrompt: 'capa cinematografica',
      motionPrompt: 'video cinematografico',
      imageProvider: 'openai',
      videoProvider: 'higgsfield',
      providerModel: 'dop-preview',
      baseImageUrl: 'https://example.com/base.png',
      coverUrl: 'https://example.com/cover.png',
      videoUrl: 'https://example.com/final.mp4',
      generationMemory: {
        coverBaseImage: {
          provider: 'openai',
          model: 'gpt-image-1',
          promptOriginal: 'base original',
          promptFinal: 'base final',
          storagePath: 'trend-videos/base.png',
        },
        finalVideo: {
          provider: 'ffmpeg',
          model: 'stitch-trend-video-clips',
          params: { durationsSec: [1.4] },
        },
      },
      shotResults: [
        {
          shotId: 'shot_1',
          label: 'Incidente',
          styleRole: 'anchor_realism',
          visualStyle: 'ultrarealista',
          styleDirection: 'fisica real e cinema de impacto',
          visualIntent: 'entrada brutal',
          subjectAction: 'o sujeito invade a cena',
          cameraMove: 'push-in agressivo',
          lens: '24mm',
          payoff: 'termina na beira do impacto',
          rhythm: 'abertura punchy',
          motionPrompt: 'motion 1',
          durationSec: 1.4,
          clipUrl: 'https://example.com/shot1.mp4',
          videoGeneration: {
            attempts: [
              {
                provider: 'higgsfield',
                model: 'dop-preview',
                mode: 'text_to_video',
                promptOriginal: 'motion 1 raw',
                promptFinal: 'motion 1 final',
              },
            ],
          },
        },
      ],
    })

    expect(pack.keyword).toBe('PROMPT')
    expect(Array.isArray(pack.assets)).toBe(true)
    expect((pack.assets as Array<unknown>).length).toBeGreaterThanOrEqual(3)
    expect((pack.delivery as { dmText: string }).dmText).toContain('PROMPT')
    expect(((pack.prompts as { shots: Array<{ lens: string; payoff: string; visualStyle: string }> }).shots[0]).lens).toBe('24mm')
    expect(((pack.prompts as { shots: Array<{ lens: string; payoff: string; styleRole: string; visualStyle: string }> }).shots[0]).styleRole).toBe('anchor_realism')
    expect(((pack.prompts as { shots: Array<{ visualStyle: string }> }).shots[0]).visualStyle).toBe('ultrarealista')
    expect(((pack.prompts as { shots: Array<{ lens: string; payoff: string }> }).shots[0]).payoff).toContain('impacto')
    expect(((pack.assets as Array<{ kind: string; promptOriginal?: string }>).find((asset) => asset.kind === 'cover_base_image'))?.promptOriginal).toBe('base original')
    expect(((pack.assets as Array<{ kind: string; model?: string; promptOriginal?: string }>).find((asset) => asset.kind === 'shot_video'))?.model).toBe('dop-preview')
    expect(((pack.assets as Array<{ kind: string; model?: string; promptOriginal?: string }>).find((asset) => asset.kind === 'shot_video'))?.promptOriginal).toBe('motion 1 raw')
  })

  it('REGRESSAO: nunca gera asset shot_image (sem imagem por shot no text-to-video)', () => {
    const pack = buildTrendGiveawayPackage({
      jobId: 'job-2',
      style: 'ultrarealista',
      angle: 'mini filme',
      hookTitle: 'HOOK',
      coverTitle: 'CAPA',
      caption: 'Legenda',
      ctaText: 'Comente "PROMPT".',
      imagePrompt: 'capa',
      motionPrompt: 'video',
      shotResults: [
        { shotId: 'shot_1', label: 'Shot 1', motionPrompt: 'm1', clipUrl: 'https://example.com/s1.mp4' },
      ],
    })

    expect((pack.assets as Array<{ kind: string }>).some((asset) => asset.kind === 'shot_image')).toBe(false)
  })
})
