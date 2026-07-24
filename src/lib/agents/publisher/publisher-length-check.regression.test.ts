import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPublishableContentText } from '@/lib/eval/quality-gate'

const SRC = readFileSync(join(process.cwd(), 'src/lib/agents/publisher/index.ts'), 'utf8')

/**
 * REGRESSÃO: publisher rejeitava posts estruturados do Brand por "excede 2200
 * caracteres" medindo o JSON bruto (headline+context+kpi+image_prompt+caption+
 * sintaxe), não a legenda que de fato vai pro Instagram. Reproduzido em produção
 * em 2026-07-18/19: item 6af662e5 tinha caption de 1089 chars (bem dentro do
 * limite de 2200 do @brand) mas foi rejeitado porque o JSON completo tinha
 * 2230 chars. O reviewer (reviewer/index.ts, via runQualityGate) já media
 * corretamente com getPublishableContentText — só o publisher usava
 * item.content.length cru.
 */
describe('REGRESSÃO: length check do publisher mede a legenda, não o JSON bruto', () => {
  const realbrandPayload = JSON.stringify({
    format: 'feed_post',
    headline: 'Saída do Equinox EV do Brasil é sinal de alerta — mas não para quem você pensa',
    context: 'A GM encerrou a linha do Equinox EV no Brasil. O movimento expõe um padrão recorrente: modelos elétricos premium chegam ao mercado antes que a infraestrutura de suporte — recarga, logística de frota e pontos de abastecimento — esteja madura o suficiente para sustentar a demanda. Quem opera estacionamentos, frotas corporativas ou varejo com área de recarga precisa ler esse movimento como dado de planejamento, não como notícia automotiva.',
    kpi: 'Prioridade editorial 85 | Score 50 | Ângulo: infraestrutura B2B | Selo: BRASIL',
    image_prompt: 'Flat lay executivo com fundo cinza escuro texturizado. À esquerda, um conector de recarga elétrica Tipo 2 apoiado sobre uma superfície metálica escovada. À direita, um gráfico minimalista em verde neon mostrando uma curva de adoção que sobe e depois cai abruptamente, com linha tracejada indicando o ponto de ruptura. No canto inferior direito, o logotipo da Brand em branco. Sem carros. Sem pessoas. Estética industrial e corporativa.',
    caption: 'A saída de um modelo elétrico do mercado brasileiro não é só notícia para o setor automotivo.\n\nÉ dado operacional para quem investe em infraestrutura de recarga.\n\nO Equinox EV encerrou sua linha no Brasil. O motivo não é tecnológico — é de equação comercial: demanda insuficiente para sustentar o modelo de negócio da montadora neste mercado, neste momento.\n\nPara gestores de frota, operadores de estacionamento, redes de varejo e administradoras de condomínio, o recado é direto:\n\n▸ O mercado EV no Brasil está em formação — não em consolidação.\n▸ Quem instala infraestrutura agora captura o ciclo de crescimento, não o de retração.\n▸ Recarga como serviço é o ativo que permanece independente de qual modelo a montadora decide descontinuar.\n\nA infraestrutura não sai de linha. O carro, sim.\n\nSe você opera um ponto com potencial de recarga e ainda não estruturou essa camada do negócio, esse é o momento de conversar.\n\n👇 Fale com a Brand.\n\n#InfraestruturaDeCarga #FrotaEletrica #MobilidadeEletrica #EVBrasil #Brand #Estacionamento #VarejoEletrico #Condominio #B2B #RecargaEletrica',
  })

  it('o payload real que travou em produção tem JSON bruto acima de 2200 mas legenda bem abaixo', () => {
    expect(realbrandPayload.length).toBeGreaterThan(2200) // era isso que o bug media (2230)
    expect(getPublishableContentText(realbrandPayload).length).toBeGreaterThan(0)
    expect(getPublishableContentText(realbrandPayload).length).toBeLessThan(2200)
  })

  it('o publisher usa getPublishableContentText no length check, não item.content.length cru', () => {
    const start = SRC.indexOf('Platform-specific length check')
    const nextStep = SRC.indexOf('// 4.', start)
    const block = SRC.slice(start, nextStep === -1 ? start + 600 : nextStep)
    expect(block).toContain('getPublishableContentText(item.content)')
    expect(block).not.toMatch(/if \(item\.content\.length > maxLength\)/)
  })
})
