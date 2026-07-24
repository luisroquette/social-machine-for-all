import { describe, expect, it } from 'vitest'
import { getPublishableContentText, runQualityGate } from './quality-gate'
import type { PlatformConfig } from '@/lib/settings/platform-config'

const instagramConfig: PlatformConfig = {
  platform: 'instagram',
  maxLength: 2200,
  allowHashtags: true,
  maxHashtags: 20,
  allowEmojis: true,
  requireImage: true,
  tone: 'editorial',
  styleGuide: '',
  engagementStyle: '',
  hashtagStrategy: '',
  active: true,
}

describe('runQualityGate structured Instagram posts', () => {
  it('applies platform text rules to the caption instead of the full structured JSON', () => {
    const content = JSON.stringify({
      format: 'feed_post',
      headline: 'Headline',
      context: 'Contexto',
      image_prompt: '#isto_nao_e_hashtag_da_legenda '.repeat(100),
      caption: 'Legenda publicável com contexto suficiente e sem hashtags para uma plataforma que não permite hashtags.',
    })
    expect(getPublishableContentText(content)).toBe('Legenda publicável com contexto suficiente e sem hashtags para uma plataforma que não permite hashtags.')
  })
  it('blocks the vague post pattern that promises recent videos without delivery', () => {
    const content = JSON.stringify({
      format: 'carousel',
      caption: 'A OpenAI revelou novidades. Acompanhe nosso perfil para saber mais sobre inteligência artificial.',
      slides: [
        { type: 'cover', headline: 'OPENAI REVELA MOMENTOS INTERESSANTES DOS VÍDEOS RECENTES' },
      ],
    })

    const result = runQualityGate(content, 'instagram', instagramConfig)

    expect(result.passed).toBe(false)
    expect(result.warnings).toContain('Capa potencialmente vaga: confirmar se slides e legenda identificam o assunto')
    expect(result.issues).toContain('Carrossel precisa ter pelo menos 2 slides')
  })

  it('blocks a carousel whose later slides do not deliver concrete information', () => {
    const content = JSON.stringify({
      format: 'carousel',
      caption: 'A OpenAI publicou três demonstrações do produto nesta semana. Veja o que cada demonstração apresentou e por que isso importa.',
      slides: [
        { type: 'cover', headline: '3 DEMONSTRAÇÕES DA OPENAI NESTA SEMANA' },
        { type: 'content', headline: 'Uma novidade', body: 'Algo interessante.' },
      ],
    })

    const result = runQualityGate(content, 'instagram', instagramConfig)

    expect(result.passed).toBe(false)
    expect(result.issues).toContain('Promessa da capa não é entregue por nenhum slide concreto')
  })

  it('passes a contextual carousel with clear progression and delivery', () => {
    const content = JSON.stringify({
      format: 'carousel',
      caption: 'A OpenAI publicou três demonstrações do novo modo de voz em 14 de julho. O carrossel resume o recurso mostrado em cada vídeo e sua aplicação prática.',
      slides: [
        { type: 'cover', headline: '3 DEMONSTRAÇÕES DO NOVO MODO DE VOZ DA OPENAI' },
        { type: 'content', headline: 'TRADUÇÃO AO VIVO', body: 'O primeiro vídeo mostra duas pessoas conversando em idiomas diferentes com tradução simultânea.' },
        { type: 'content', headline: 'CONTROLE DE TOM', body: 'A segunda demonstração permite orientar ritmo, emoção e estilo da resposta falada.' },
      ],
    })

    expect(runQualityGate(content, 'instagram', instagramConfig).passed).toBe(true)
  })

  it('does not reject an otherwise coherent post for a non-critical style warning', () => {
    const content = JSON.stringify({
      format: 'feed_post',
      headline: 'OPENAI APRESENTA NOVO MODO DE VOZ',
      context: 'Demonstração publicada em 14 de julho.',
      caption: 'A OPENAI MOSTROU O NOVO MODO DE VOZ EM UMA DEMONSTRAÇÃO PÚBLICA COM TRADUÇÃO SIMULTÂNEA E CONTROLE DE TOM.',
    })

    const result = runQualityGate(content, 'instagram', instagramConfig)

    expect(result.passed).toBe(true)
    expect(result.warnings).toContain('Excessive use of capital letters')
  })
})
