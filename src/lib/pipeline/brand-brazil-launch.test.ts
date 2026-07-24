import { describe, expect, it } from 'vitest'
import { evaluatebrandBrazilLaunch, isBrazilRelevantbrandSource, calculateValidatedEngagement, VALIDATED_VIRAL_ENGAGEMENT } from './brand-brazil-launch'

describe('brand brazil launch relevance', () => {
  it('aprova lançamento confirmado no Brasil', () => {
    const result = evaluatebrandBrazilLaunch('Tesla lança Model 3 no Brasil por R$ 250 mil com início de vendas no Brasil para o segundo semestre')
    expect(result.eligible).toBe(true)
    expect(result.category).toBe('sales_brazil')
    expect(result.score).toBeGreaterThanOrEqual(70)
  })

  it('aprova produção local no Brasil', () => {
    const result = evaluatebrandBrazilLaunch('Geely EX5 híbrido fabricado no Brasil com produção local para abastecer o mercado brasileiro')
    expect(result.eligible).toBe(true)
    expect(result.category).toBe('production_brazil')
  })

  it('rejeita lançamento na China sem confirmação Brasil', () => {
    const result = evaluatebrandBrazilLaunch('BYD apresenta o novo Seal 08 PHEV na China com 400 km de autonomia elétrica e preço equivalente a R$ 150 mil')
    expect(result.eligible).toBe(false)
    expect(result.category).toBe('rejected_price_conversion_only')
  })

  it('rejeita CLTC sem contexto Brasil', () => {
    const result = evaluatebrandBrazilLaunch('Novo sedã elétrico chinês promete 905 km no ciclo CLTC e estreia no mercado internacional')
    expect(result.eligible).toBe(false)
    expect(result.category).toBe('rejected_cltc_no_brazil')
  })

  it('rejeita rumor internacional', () => {
    const result = evaluatebrandBrazilLaunch('Rumor: MG4 pode chegar ao Brasil no ano que vem se a marca decidir priorizar a América Latina')
    expect(result.eligible).toBe(false)
    expect(result.category).toBe('rejected_rumor')
  })

  it('nao bloqueia conteudo de infraestrutura', () => {
    const result = evaluatebrandBrazilLaunch('Rede de eletropostos DC fast cresce com foco em operação de frota elétrica e recarga corporativa')
    expect(result.eligible).toBe(true)
    expect(result.category).toBe('non_vehicle_market_story')
  })

  it('rejeita reel estrangeiro de EV sem contexto Brasil', () => {
    expect(isBrazilRelevantbrandSource('Electric Car Earthing Wire Needed at Home? In this video charging Hyundai EV directly from a normal home socket.')).toBe(false)
    expect(isBrazilRelevantbrandSource('Tesla Model 3 drives through floodwaters in Dubai.')).toBe(false)
    expect(isBrazilRelevantbrandSource('Quem dirige carro elétrico sabe que o silêncio faz parte da experiência. Mas o dono do BYD resolveu fazer ele mesmo o ronco do motor.')).toBe(false)
  })

  it('mantem elegivel conteudo geral de EV quando o contexto e Brasil', () => {
    expect(isBrazilRelevantbrandSource('Infraestrutura de recarga para carros elétricos cresce no Brasil com foco em condomínios e frotas.')).toBe(true)
  })

  // REGRESSÃO: exigir a palavra literal "brasil" perdia notícias genuinamente
  // nacionais que só citam estado/cidade/veículo de imprensa (achado 2026-07-11,
  // fila do Brand zerada — 0/40 candidatos elegíveis passavam no filtro).
  it('REGRESSÃO: aprova noticia nacional que cita estado/emissora sem a palavra Brasil', () => {
    expect(isBrazilRelevantbrandSource('A Band Bahia apresentou nos bastidores sua nova frota de veículos da BYD, que passa a ser utilizada pelas equipes de reportagem da emissora.')).toBe(true)
  })

  it('REGRESSÃO: aprova noticia nacional citando capital sem a palavra Brasil', () => {
    expect(isBrazilRelevantbrandSource('Frota de carros elétricos chega a São Paulo para operar em serviço de mobilidade urbana da prefeitura.')).toBe(true)
  })

  it('REGRESSÃO: continua rejeitando conteudo estrangeiro mesmo com cidade citada', () => {
    expect(isBrazilRelevantbrandSource('Tesla inaugura nova fábrica em Berlim e amplia a produção de veículos elétricos na Europa.')).toBe(false)
  })

  // REGRESSÃO: conteúdo nacional viral — sem citar lugar/mídia, mas em
  // português e com engajamento JÁ ALCANÇADO (não potencial/score preditivo)
  // muito acima do normal.
  it('REGRESSÃO: aprova conteudo viral em portugues sem mencao a lugar', () => {
    const text = 'kkkkk esse motorista de carro elétrico não aguentou e saiu xingando o carregador que travou no meio do rolê'
    expect(isBrazilRelevantbrandSource(text)).toBe(false) // sem metricas, nao e considerado validado
    expect(isBrazilRelevantbrandSource(text, { likes: 400, retweets: 30, replies: 20 })).toBe(true) // engajamento real acima do corte
  })

  it('REGRESSÃO: nao aprova conteudo viral em ingles mesmo com engajamento real alto', () => {
    expect(isBrazilRelevantbrandSource(
      'This electric car charger just caught fire in the middle of the street, wild video',
      { likes: 5000, retweets: 500, replies: 300 }
    )).toBe(false)
  })

  it('REGRESSÃO: nao aprova portugues com engajamento real abaixo do corte de viralidade', () => {
    expect(isBrazilRelevantbrandSource('Não acredito que o carregador do meu carro elétrico travou de novo, kkkk', { likes: 10, retweets: 1, replies: 0 })).toBe(false)
  })

  it('REGRESSÃO: relevance_score alto sozinho nao basta — engajamento tem que ser real', () => {
    // Post fictício com score preditivo alto (ex: por ser recente/autor grande)
    // mas quase nenhuma curtida/RT/resposta de verdade — nao deve passar.
    expect(isBrazilRelevantbrandSource('kkkk mano esse carregador nao aguentou', { likes: 2, retweets: 0, replies: 1 })).toBe(false)
  })

  // Calibrado 2026-07-11 contra amostra real do Brand (ver commit e8313fd):
  // post com 807 curtidas/72 RT/50 respostas cruza bem o corte; post com
  // 8 curtidas/2 RT/1 resposta fica bem abaixo.
  it('calculateValidatedEngagement cruza o corte para post real ja viral', () => {
    expect(calculateValidatedEngagement({ likes: 807, retweets: 72, replies: 50 })).toBeGreaterThanOrEqual(VALIDATED_VIRAL_ENGAGEMENT)
  })

  it('calculateValidatedEngagement fica abaixo do corte para post de baixo engajamento', () => {
    expect(calculateValidatedEngagement({ likes: 8, retweets: 2, replies: 1 })).toBeLessThan(VALIDATED_VIRAL_ENGAGEMENT)
  })
})
