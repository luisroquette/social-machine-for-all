import { describe, expect, it } from 'vitest'
import { runQualityGate } from './quality-gate'
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

// REGRESSÃO: publicado de verdade no @brand em 2026-07-19 (post
// instagram.com/p/Da9HuXEkrKz, deletado manualmente depois). O writer é
// instruído a escrever "context": "1-2 frases" e "kpi": "métrica ... da
// fonte", mas nada validava isso — o gate só checava se context estava
// vazio. O post real tinha um parágrafo inteiro de 3 frases como context
// (renderizado como corpo de texto na imagem — "wall of text") e o kpi
// continha metadado interno de priorização do pipeline
// (editorial_priority_score/launch_score) em vez de uma métrica pública:
// "Prioridade editorial 85 | Score 50 | Ângulo: infraestrutura B2B | Selo: BRASIL".
describe('REGRESSÃO: vazamento de metadado interno e context longo demais (feed_post)', () => {
  const realLeakedPayload = JSON.stringify({
    format: 'feed_post',
    headline: 'Saída do Equinox EV do Brasil é sinal de alerta — mas não para quem você pensa',
    context: 'A GM encerrou a linha do Equinox EV no Brasil. O movimento expõe um padrão recorrente: modelos elétricos premium chegam ao mercado antes que a infraestrutura de suporte — recarga, logística de frota e pontos de abastecimento — esteja madura o suficiente para sustentar a demanda. Quem opera estacionamentos, frotas corporativas ou varejo com área de recarga precisa ler esse movimento como dado de planejamento, não como notícia automotiva.',
    kpi: 'Prioridade editorial 85 | Score 50 | Ângulo: infraestrutura B2B | Selo: BRASIL',
    image_prompt: 'Flat lay executivo com fundo cinza escuro texturizado.',
    caption: 'A saída de um modelo elétrico do mercado brasileiro não é só notícia para o setor automotivo. É dado operacional para quem investe em infraestrutura de recarga. Fale com a Brand. #InfraestruturaDeCarga #FrotaEletrica #MobilidadeEletrica #EVBrasil #Brand #Estacionamento #VarejoEletrico #Condominio #B2B #RecargaEletrica',
  })

  it('rejeita o payload real que vazou metadado interno de pipeline no kpi', () => {
    const result = runQualityGate(realLeakedPayload, 'instagram', instagramConfig)
    expect(result.passed).toBe(false)
    expect(result.issues.join(' ')).toContain('Metadado interno de pipeline vazou')
  })

  it('rejeita o payload real por context virar parágrafo (3 frases) em vez de 1-2', () => {
    const result = runQualityGate(realLeakedPayload, 'instagram', instagramConfig)
    expect(result.issues.some((i) => i.includes('Contexto longo demais'))).toBe(true)
  })

  it('não rejeita um kpi legítimo com métricas reais da fonte', () => {
    const goodPayload = JSON.stringify({
      format: 'feed_post',
      headline: '100 mil BYDs fabricados no Brasil',
      context: 'A BYD atingiu 100 mil veículos montados em Camaçari (BA).',
      kpi: '100.000 veículos montados | R$ 5,5 bi em investimentos | 5.500 empregos diretos',
      image_prompt: 'Flat lay executivo.',
      caption: 'Marco industrial: 100 mil veículos BYD fabricados em Camaçari, com investimento bilionário e milhares de empregos diretos no Brasil, mostrando a escala da eletrificação nacional. #Brand #EVBrasil',
    })
    const result = runQualityGate(goodPayload, 'instagram', instagramConfig)
    expect(result.issues.some((i) => i.includes('Metadado interno de pipeline vazou'))).toBe(false)
    expect(result.issues.some((i) => i.includes('Contexto longo demais'))).toBe(false)
  })
})
