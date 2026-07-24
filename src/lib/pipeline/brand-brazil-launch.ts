export type brandBrazilLaunchCategory =
  | 'launch_brazil'
  | 'price_brazil'
  | 'sales_brazil'
  | 'production_brazil'
  | 'other_brazil_ev'
  | 'non_vehicle_market_story'
  | 'rejected_global_only'
  | 'rejected_price_conversion_only'
  | 'rejected_cltc_no_brazil'
  | 'rejected_rumor'

export type brandBrazilLaunchResult = {
  eligible: boolean
  category: brandBrazilLaunchCategory
  score: number
  reasons: string[]
}

const AUTO_BRANDS = /\b(byd|tesla|geely|chery|caoa chery|gwm|ora|volvo|zeekr|nio|xpeng|li auto|jac|emova|mg\b|mg\d+\b|gm\b|chevrolet|renault|hyundai|kia|bmw|mercedes|audi|volkswagen|vw)\b/i
const VEHICLE_BODY_SIGNAL = /\b(seda|sedan|sed[aã]o|suv|hatch|picape|crossover|modelo)\b/i
const VEHICLE_MARKET_NEWS = /\b(lan[cç]a(?:mento)?|lancar|lançar|estreia|chega|chegada|chegar|pre[cç]o|custa|custar|venda(?:s)?|vender|fabricad[oa]s?|produzid[oa]s?|producao|produção|montad[oa]s?|garantia|autonomia|seda[nã]?|suv|hatch|picape|modelo)\b/i
const BRAZIL_SIGNAL = /\b(brasil|mercado brasileiro|mercado nacional|no pais|no país|aqui no brasil|chega ao brasil|chega no brasil|lan[cç]ado no brasil|lanca no brasil|pre[cç]o no brasil|vendas no brasil|vendid[oa]s? no brasil|fabricad[oa]s? no brasil|produzid[oa]s? no brasil|montad[oa]s? no brasil)\b/i
// Nomes de estado/capital e veículos de imprensa brasileiros — cobre notícias
// genuinamente nacionais que não citam a palavra "Brasil" (ex: "Band Bahia
// apresentou sua frota de BYD"). Exigir o literal "brasil" perdia esses casos.
const BRAZIL_PLACE_SIGNAL = /\b(bahia|salvador|sao paulo|são paulo|rio de janeiro|minas gerais|belo horizonte|parana|paraná|curitiba|rio grande do sul|porto alegre|pernambuco|recife|ceara|ceará|fortaleza|santa catarina|florianopolis|florianópolis|goias|goiás|goiania|goiânia|distrito federal|brasilia|brasília|espirito santo|espírito santo|vitoria|vitória|amazonas|manaus|belem|belém|maranhao|maranhão|piaui|piauí|alagoas|maceio|maceió|sergipe|aracaju|paraiba|paraíba|joao pessoa|joão pessoa|rio grande do norte|natal|mato grosso|cuiaba|cuiabá|campo grande|rondonia|rondônia|roraima|acre|amapa|amapá|tocantins)\b/i
const BRAZIL_OUTLET_SIGNAL = /\b(band bahia|rede globo|globo news|record tv|redetv|\bsbt\b|\bg1\b|\buol\b|folha de s\.?\s?paulo|estadao|estadão|cnn brasil|metropoles|metrópoles|poder360|infomoney)\b/i

function hasBrazilSignal(normalized: string): boolean {
  return has(normalized, BRAZIL_SIGNAL) || has(normalized, BRAZIL_PLACE_SIGNAL) || has(normalized, BRAZIL_OUTLET_SIGNAL)
}

// Marcadores léxicos exclusivos do português (ausentes em espanhol/inglês/hindi,
// os outros idiomas que aparecem no pool curado) — usados só como sinal de
// idioma, nunca como sinal de tópico.
const PT_LANGUAGE_SIGNAL = /\b(nao|entao|tambem|voce|oxe|uai|eita|caramba|mano|galera|treco|pqp)\b|kkk+/i

// Engajamento JÁ ALCANÇADO (não potencial): mesmos pesos de ação real usados
// em ENGAGEMENT_WEIGHTS de virality-score.ts (retweet=20, reply=13.5, like=1),
// mas SEM as camadas preditivas daquele score (decay de freshness, velocity,
// autoridade do autor, cascade potential) — relevance_score mistura tudo isso
// e pode dar 83 pra um post de baixo engajamento real só porque é recente ou
// do autor certo. "views" do X é métrica de impressão inflável e não entra
// aqui — o próprio ENGAGEMENT_WEIGHTS já a exclui de propósito.
// Calibrado 2026-07-11 contra amostra real do Brand: itens com engajamento
// já validado (curtidas/RT/resposta reais) cruzam ~500-900; ruído fica <250.
export function calculateValidatedEngagement(metrics?: { likes?: number; retweets?: number; replies?: number }): number {
  return (metrics?.likes ?? 0) + (metrics?.retweets ?? 0) * 20 + (metrics?.replies ?? 0) * 13.5
}
export const VALIDATED_VIRAL_ENGAGEMENT = 500
const PRICE_SIGNAL = /\b(pre[cç]o no brasil|custa|custar|r\$\s?\d|r\$\s?\d+[.,]?\d*\s?mil)\b/i
const SALES_SIGNAL = /\b(inicio de vendas|início de vendas|vendas no brasil|vendid[oa]s? no brasil|estreou no brasil|estreia no brasil|comecou a vender|começou a vender)\b/i
const PRODUCTION_SIGNAL = /\b(fabricad[oa]s? no brasil|produzid[oa]s? no brasil|montad[oa]s? no brasil|producao local|produção local|fabrica no brasil|fábrica no brasil)\b/i
const LAUNCH_SIGNAL = /\b(chega ao brasil|chega no brasil|lanca no brasil|lan[cç]amento no brasil|estreia no brasil)\b/i
const CHINA_GLOBAL_SIGNAL = /\b(china|mercado chines|mercado chin[eê]s|global|internacional|europa|eua|estados unidos)\b/i
const PRICE_CONVERSION_SIGNAL = /\b(convers[aã]o direta|equivalente a|yuan|yuans|dolar|dólar|usd)\b/i
const CLTC_SIGNAL = /\b(cltc)\b/i
const RUMOR_SIGNAL = /\b(rumor|rumores|especula|especulado|pode chegar|poderia chegar|deve chegar|seria lancado|seria lançado|cotado para)\b/i
const GENERAL_EV_BRAZIL_SIGNAL = /\b(carro.{1,3}el[eé]tricos?|ve[íi]culos?.{1,3}el[eé]tricos?|mobilidade.?eletrica|frota.?eletrica|eletroposto|recarga|carregador(?:es)?)\b/i

function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function has(text: string, regex: RegExp): boolean {
  regex.lastIndex = 0
  return regex.test(text)
}

export function evaluatebrandBrazilLaunch(text: string): brandBrazilLaunchResult {
  const normalized = normalizeText(text)
  const reasons: string[] = []

  const isVehicleMarketStory = (has(normalized, AUTO_BRANDS) || has(normalized, VEHICLE_BODY_SIGNAL)) && has(normalized, VEHICLE_MARKET_NEWS)
  if (!isVehicleMarketStory) {
    return {
      eligible: true,
      category: 'non_vehicle_market_story',
      score: 0,
      reasons: ['non_vehicle_market_story'],
    }
  }

  const hasBrazil = hasBrazilSignal(normalized)
  const hasPrice = has(normalized, PRICE_SIGNAL)
  const hasSales = has(normalized, SALES_SIGNAL)
  const hasProduction = has(normalized, PRODUCTION_SIGNAL)
  const hasLaunch = has(normalized, LAUNCH_SIGNAL)
  const hasChinaGlobal = has(normalized, CHINA_GLOBAL_SIGNAL)
  const hasPriceConversion = has(normalized, PRICE_CONVERSION_SIGNAL)
  const hasCltc = has(normalized, CLTC_SIGNAL)
  const hasRumor = has(normalized, RUMOR_SIGNAL)
  const hasStrongBrand = has(normalized, AUTO_BRANDS)

  let score = 0
  if (hasBrazil) { score += 40; reasons.push('brazil_confirmed') }
  if (hasPrice && hasBrazil) { score += 20; reasons.push('price_brazil') }
  if (hasSales) { score += 20; reasons.push('sales_brazil') }
  if (hasProduction) { score += 15; reasons.push('production_brazil') }
  if (hasStrongBrand) { score += 10; reasons.push('strong_brand') }
  if (hasLaunch) { score += 10; reasons.push('launch_brazil') }

  if (hasRumor) {
    score -= 40
    reasons.push('rumor_signal')
    return { eligible: false, category: 'rejected_rumor', score, reasons }
  }

  if (hasPriceConversion && !hasBrazil) {
    score -= 50
    reasons.push('price_conversion_only')
    return { eligible: false, category: 'rejected_price_conversion_only', score, reasons }
  }

  if (hasCltc && !hasBrazil) {
    score -= 25
    reasons.push('cltc_without_brazil')
    return { eligible: false, category: 'rejected_cltc_no_brazil', score, reasons }
  }

  if (hasChinaGlobal && !hasBrazil) {
    score -= 50
    reasons.push('global_only')
    return { eligible: false, category: 'rejected_global_only', score, reasons }
  }

  if (!hasBrazil) {
    score -= 50
    reasons.push('missing_brazil_confirmation')
    return { eligible: false, category: 'rejected_global_only', score, reasons }
  }

  const category: brandBrazilLaunchCategory = hasProduction
    ? 'production_brazil'
    : hasSales
      ? 'sales_brazil'
      : hasPrice
        ? 'price_brazil'
        : hasLaunch
          ? 'launch_brazil'
          : 'other_brazil_ev'

  return { eligible: true, category, score, reasons }
}

export function isBrazilRelevantbrandSource(
  sourceContent: string,
  metrics?: { likes?: number; retweets?: number; replies?: number }
): boolean {
  const result = evaluatebrandBrazilLaunch(sourceContent)
  if (!result.eligible) return false
  if (result.category !== 'non_vehicle_market_story') return true

  const normalized = normalizeText(sourceContent)
  const hasGeneralEvContext = has(normalized, GENERAL_EV_BRAZIL_SIGNAL) || has(normalized, AUTO_BRANDS)
  if (!hasGeneralEvContext) return false

  if (hasBrazilSignal(normalized)) return true

  // Conteúdo nacional viral: sem citar lugar/mídia, mas escrito em português
  // e com engajamento JÁ ALCANÇADO (curtidas/RT/resposta reais, não score
  // preditivo) muito acima do normal — o público brasileiro já validou esse
  // conteúdo, não estamos apostando em potencial.
  if (has(normalized, PT_LANGUAGE_SIGNAL) && calculateValidatedEngagement(metrics) >= VALIDATED_VIRAL_ENGAGEMENT) return true

  return false
}
