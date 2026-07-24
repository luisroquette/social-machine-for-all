/**
 * Virality Score Algorithm v2 — "Equação Uchu"
 *
 * Modelo de predição de viralidade inspirado nos algoritmos reais de
 * X (open-sourced 2023), Instagram, TikTok e papers acadêmicos.
 *
 * Arquitetura: Multi-signal scoring com 7 dimensões independentes
 * combinadas via média geométrica ponderada.
 *
 * Score final: 0-100 (normalizado)
 *
 * Referências:
 * - X algorithm (github.com/twitter/the-algorithm): signal weights
 * - Instagram ranking: watch time, shares/reach, saves
 * - TikTok FYP: seed group testing, completion rate
 * - Facebook EdgeRank (legacy): affinity × weight × decay
 * - Academic: PLOS ONE infectivity decay, ViralGCN cascade prediction
 */

// ══════════════════════════════════════════════════════════════════
// DIMENSION 1: ENGAGEMENT QUALITY (EQ)
// ══════════════════════════════════════════════════════════════════
//
// Baseado no X open-source algorithm (2023):
// - Reply to tweet: +13.5x (vs like=1x)
// - Retweet: +20x
// - Bookmark: +10x
// - Profile click: +12x
// - Author reply to reply: +75x
//
// Pesos calibrados para dados disponíveis via API:

const ENGAGEMENT_WEIGHTS = {
  retweet: 20,      // Maior alcance: coloca no feed de toda outra audiência
  reply: 13.5,      // Sinal forte: pessoa parou, leu, escreveu
  quote: 25,        // Máximo sinal: pessoa criou conteúdo sobre o conteúdo
  bookmark: 10,     // Sinal oculto forte: salvo para referência futura
  like: 1,          // Baseline: baixo esforço, pouca amplificação
}

// ══════════════════════════════════════════════════════════════════
// DIMENSION 2: ENGAGEMENT VELOCITY (EV)
// ══════════════════════════════════════════════════════════════════
//
// A VELOCIDADE do engagement é mais importante que o VOLUME.
// Todas as plataformas usam os primeiros 15-60 minutos como
// indicador de potencial viral.
//
// Posts com strong first-hour engagement recebem ~40% mais alcance.
// (Fonte: Hootsuite Social Media Algorithms 2026)
//
// Modelo: engagement_rate / hours_since_post
// Normalizado logaritmicamente para lidar com outliers.

// ══════════════════════════════════════════════════════════════════
// DIMENSION 3: TIME FRESHNESS (TF)
// ══════════════════════════════════════════════════════════════════
//
// Exponential decay calibrado por plataforma:
//
// X/Twitter half-life: 43 minutos (ScottGraffius 2025)
// Facebook half-life: 76 minutos
// Reddit half-life: 155 minutos
//
// Modelo: score = e^(-λt) onde λ = ln(2) / half_life
//
// Para nosso algoritmo, usamos half-life de 3 horas (mais generoso
// que os 43min do X) porque buscamos conteúdo para curar/adaptar,
// não competir no feed em real-time.

const TIME_HALF_LIFE_HOURS = 3

// ══════════════════════════════════════════════════════════════════
// DIMENSION 4: AUTHOR AUTHORITY (AA)
// ══════════════════════════════════════════════════════════════════
//
// X usa TweepCred (0-100) internamente.
// Instagram: account age + past performance + consistency
// TikTok: ignora followers, foca em performance per-post
//
// Nosso modelo combina:
// - Followers (logarítmico — evita domínio de mega-influencers)
// - Verified status (+15 boost, baseado no X +2-4x multiplier)
// - Following ratio (followers/following > 10 = thought leader)
//
// Escala: log10(followers) normalizado contra 1M ceiling

const AUTHORITY_CEILING = 1_000_000
const VERIFIED_BOOST = 15
const FOLLOWING_RATIO_THRESHOLD = 10

// ══════════════════════════════════════════════════════════════════
// DIMENSION 5: CONTENT RELEVANCE (CR)
// ══════════════════════════════════════════════════════════════════
//
// 3 tiers de keywords com pesos diferenciados.
// Inspirado em TF-IDF: termos mais específicos do nicho
// pesam mais que termos genéricos.
//
// Tier 1 (peso 5): Termos CORE — se aparece, é do nosso nicho com certeza
// Tier 2 (peso 3): Termos RELATED — bom indicador de relevância
// Tier 3 (peso 1): Termos BROAD — contexto geral de tech

// Tier 1: marcas e termos que o público GERAL conhece — alta relevância para conteúdo acessível
// Tier 2: termos técnicos de ML/IA — relevantes para nicho, mas não para topo de funil
// Tier 3: contexto broad de tech
const RELEVANCE_TIERS: Array<{ weight: number; keywords: string[] }> = [
  {
    weight: 5,
    keywords: [
      // Marcas conhecidas pelo público geral
      'openai', 'anthropic', 'google', 'gemini', 'claude', 'gpt', 'chatgpt',
      'perplexity', 'copilot', 'cursor', 'midjourney', 'sora', 'dall-e',
      'deepseek', 'mistral', 'llama', 'meta ai', 'grok', 'xai',
      // Termos de uso acessíveis
      'claude code', 'ai tools', 'ai assistant', 'chatbot', 'ai app',
      'como usar', 'dica de ia', 'prompt', 'ai agent', 'ai agents',
      // Conceitos que o público geral entende
      'context window', 'multimodal', 'voice ai', 'image generation',
    ],
  },
  {
    weight: 3,
    keywords: [
      // Técnico mas reconhecível por entusiastas
      'llm', 'agentic', 'reasoning', 'chain of thought', 'fine-tuning',
      'rag', 'langchain', 'langgraph', 'embedding', 'vector database',
      'machine learning', 'deep learning', 'neural network', 'benchmark',
      'inference', 'training', 'model weights', 'diffusion', 'rlhf', 'dpo',
      'quantization', 'lora', 'qlora', 'coding agent',
    ],
  },
  {
    weight: 1,
    keywords: [
      // Contexto geral de tech
      'artificial intelligence', 'ai', 'automation', 'robotics',
      'data science', 'nlp', 'computer vision', 'open source',
      'hugging face', 'arxiv', 'paper', 'gpu', 'vram', 'transformer',
      'api', 'developer', 'startup', 'saas', 'cloud', 'semiconductor',
    ],
  },
]

// ══════════════════════════════════════════════════════════════════
// DIMENSION 6: CONTENT TYPE SIGNAL (CT)
// ══════════════════════════════════════════════════════════════════
//
// X: video nativo = 10x engagement vs texto
// X: links externos = -50-90% alcance (penalidade)
// Instagram: visual content > texto
// TikTok: completion rate do vídeo
//
// Para curadoria, QUEREMOS links (são nossa matéria-prima).
// Mas reconhecemos que tweets com mídia performam melhor.

const CONTENT_TYPE_MULTIPLIERS = {
  hasVideo: 2.5,       // Vídeo nativo: máximo boost
  hasImage: 1.8,       // Imagem: forte boost
  hasExternalLink: 1.3, // Link externo: bom pra curadoria, ok pra reach
  hasThread: 1.5,      // Thread indicator: conteúdo substancial
  textOnly: 1.0,       // Baseline
}

// ══════════════════════════════════════════════════════════════════
// DIMENSION 8: SENTIMENT SIGNAL (SS) — Optimization 10
// ══════════════════════════════════════════════════════════════════
//
// Rule-based sentiment scoring to penalize negative/toxic content
// and reward constructive/informative content.
// No AI calls — purely keyword-based for cost efficiency.

const NEGATIVE_SIGNALS = [
  'scam', 'fraud', 'hack', 'stolen', 'lawsuit', 'fired', 'layoff',
  'crash', 'fail', 'broke', 'worst', 'terrible', 'horrible', 'dead',
]

const POSITIVE_SIGNALS = [
  'launch', 'released', 'breakthrough', 'benchmark', 'outperform',
  'improve', 'open source', 'free', 'announce', 'paper', 'research',
  'demo', 'tutorial',
]

// ══════════════════════════════════════════════════════════════════
// SOURCE DOMAIN QUALITY — Optimization 12
// ══════════════════════════════════════════════════════════════════
//
// Premium domains boost content type signal, spam domains penalize.

const PREMIUM_DOMAINS = [
  'arxiv.org', 'github.com', 'techcrunch.com', 'theverge.com',
  'wired.com', 'nature.com', 'science.org', 'huggingface.co',
  'openai.com', 'anthropic.com', 'deepmind.google', 'blog.google',
  'engineering.fb.com', 'arstechnica.com', 'ieee.org',
]

const SPAM_DOMAINS = [
  'bit.ly/suspicious', 'tinyurl.com',
]

// ══════════════════════════════════════════════════════════════════
// DIMENSION 7: CASCADE POTENTIAL (CP)
// ══════════════════════════════════════════════════════════════════
//
// Baseado em papers acadêmicos (PLOS ONE, ViralGCN):
// - R0 (basic reproduction number) > 1 = cascade grows
// - Engagement-to-impression ratio predicts cascade viability
// - Reply chains indicate active discussion (X: reply chain = +75x)
//
// Modelo simplificado: engagement_rate × reply_ratio
// Se muitas replies relativas a likes = discussão ativa = cascade

// ══════════════════════════════════════════════════════════════════
// TYPES
// ════════════��═════════════════════════════════════════════════════

export interface ViralityInput {
  // Engagement metrics
  likes: number
  retweets: number
  replies: number
  quotes?: number
  bookmarks?: number
  views?: number

  // Author info
  authorFollowers?: number
  authorFollowing?: number
  authorVerified?: boolean

  // Timing
  createdAt: string | Date

  // Content
  text: string
  hasMedia?: boolean
  mediaTypes?: string[] // 'photo', 'video', 'animated_gif'
  hasExternalLink?: boolean

  // Optional overrides
  customRelevanceKeywords?: string[]
}

export interface ViralityResult {
  /** Final composite score 0-100 */
  score: number

  /** Tier classification */
  tier: 'viral' | 'high_potential' | 'above_average' | 'average' | 'below_average' | 'noise'

  /** 8 dimension scores (each 0-100) */
  dimensions: {
    engagementQuality: number
    engagementVelocity: number
    timeFreshness: number
    authorAuthority: number
    contentRelevance: number
    contentTypeSignal: number
    cascadePotential: number
    sentimentSignal: number
  }

  /** Dimension weights used */
  weights: Record<string, number>

  /** Detailed breakdown for transparency */
  breakdown: {
    // Engagement
    weightedEngagement: number
    engagementPerView: number
    dominantEngagementType: string

    // Velocity
    engagementPerHour: number
    velocityTier: string

    // Time
    hoursOld: number
    decayFactor: number

    // Authority
    followerScore: number
    followRatio: number
    verifiedBoost: number

    // Relevance
    keywordsMatched: string[]
    relevancePoints: number
    relevanceTier: string

    // Content
    contentTypeMultiplier: number
    contentSignals: string[]

    // Cascade
    replyToLikeRatio: number
    cascadeR0Estimate: number

    // Sentiment
    sentimentScore: number
    positiveSignals: string[]
    negativeSignals: string[]

    // Domain quality
    domainQualityBoost: number
  }
}

// ══════════════════════════════════════════════════════════════════
// DIMENSION WEIGHTS
// ══════════════════════════════════════════════════════════════════
//
// Média geométrica ponderada: cada dimensão tem um peso que
// define sua importância relativa no score final.
//
// Total = 100% distribuído por importância empírica.

const DIMENSION_WEIGHTS = {
  engagementQuality: 0.225,  // 22.5% — o mais importante: engagement real (-2.5% for sentiment)
  engagementVelocity: 0.20,  // 20% — velocidade indica potencial viral
  timeFreshness: 0.15,       // 15% — conteúdo fresco importa
  authorAuthority: 0.10,     // 10% — quem disse importa, mas não é tudo
  contentRelevance: 0.15,    // 15% — deve ser do nosso nicho
  contentTypeSignal: 0.05,   // 5% — tipo de mídia é bonus
  cascadePotential: 0.075,   // 7.5% — potencial de viralização (-2.5% for sentiment)
  sentimentSignal: 0.05,     // 5% — sentiment quality (Optimization 10)
}

// ══════════════════════════════════════════════════════════════════
// CORE ALGORITHM
// ══════════════════════════════════════════════════════════════════

export function calculateViralityScore(input: ViralityInput): ViralityResult {
  // Calculate each dimension (0-100)
  const eq = calcEngagementQuality(input)
  const ev = calcEngagementVelocity(input)
  const tf = calcTimeFreshness(input.createdAt)
  const aa = calcAuthorAuthority(input)
  const cr = calcContentRelevance(input.text, input.customRelevanceKeywords)
  const ct = calcContentTypeSignal(input)
  const cp = calcCascadePotential(input)
  const ss = calcSentimentSignal(input.text)

  // Weighted power mean (generalization of geometric mean)
  // score = Σ(wi × Di^p) ^ (1/p) where p controls emphasis on low scores
  // p=1: arithmetic mean, p→0: geometric mean, p=-1: harmonic mean
  // We use p=0.5 (between arithmetic and geometric) for balance
  const p = 0.5
  const dimensions = [
    { score: eq.score, weight: DIMENSION_WEIGHTS.engagementQuality },
    { score: ev.score, weight: DIMENSION_WEIGHTS.engagementVelocity },
    { score: tf.score, weight: DIMENSION_WEIGHTS.timeFreshness },
    { score: aa.score, weight: DIMENSION_WEIGHTS.authorAuthority },
    { score: cr.score, weight: DIMENSION_WEIGHTS.contentRelevance },
    { score: ct.score, weight: DIMENSION_WEIGHTS.contentTypeSignal },
    { score: cp.score, weight: DIMENSION_WEIGHTS.cascadePotential },
    { score: ss.score, weight: DIMENSION_WEIGHTS.sentimentSignal },
  ]

  const weightedSum = dimensions.reduce(
    (sum, d) => sum + d.weight * Math.pow(Math.max(d.score, 0.01), p),
    0
  )
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0)
  const rawScore = Math.pow(weightedSum / totalWeight, 1 / p)
  const score = Math.min(100, Math.max(0, Math.round(rawScore)))

  return {
    score,
    tier: classifyTier(score),
    dimensions: {
      engagementQuality: Math.round(eq.score),
      engagementVelocity: Math.round(ev.score),
      timeFreshness: Math.round(tf.score),
      authorAuthority: Math.round(aa.score),
      contentRelevance: Math.round(cr.score),
      contentTypeSignal: Math.round(ct.score),
      cascadePotential: Math.round(cp.score),
      sentimentSignal: Math.round(ss.score),
    },
    weights: DIMENSION_WEIGHTS,
    breakdown: {
      weightedEngagement: eq.weighted,
      engagementPerView: eq.perView,
      dominantEngagementType: eq.dominant,
      engagementPerHour: ev.perHour,
      velocityTier: ev.tier,
      hoursOld: tf.hoursOld,
      decayFactor: tf.decay,
      followerScore: aa.followerScore,
      followRatio: aa.followRatio,
      verifiedBoost: aa.verified ? VERIFIED_BOOST : 0,
      keywordsMatched: cr.matched,
      relevancePoints: cr.points,
      relevanceTier: cr.tier,
      contentTypeMultiplier: ct.multiplier,
      contentSignals: ct.signals,
      replyToLikeRatio: cp.replyRatio,
      cascadeR0Estimate: cp.r0,
      sentimentScore: ss.score,
      positiveSignals: ss.positiveMatched,
      negativeSignals: ss.negativeMatched,
      domainQualityBoost: ct.domainBoost,
    },
  }
}

// ══════════════════════════════════════════════════════════════════
// DIMENSION CALCULATIONS
// ══════════════════════════════════════════════════════════════════

function calcEngagementQuality(input: ViralityInput): {
  score: number; weighted: number; perView: number; dominant: string
} {
  const weighted =
    input.retweets * ENGAGEMENT_WEIGHTS.retweet +
    input.replies * ENGAGEMENT_WEIGHTS.reply +
    (input.quotes ?? 0) * ENGAGEMENT_WEIGHTS.quote +
    (input.bookmarks ?? 0) * ENGAGEMENT_WEIGHTS.bookmark +
    input.likes * ENGAGEMENT_WEIGHTS.like

  // Estimate views if not available (industry avg: 2% engagement rate)
  const views = input.views ?? Math.max(input.likes * 50, 100)
  const perView = weighted / Math.max(views, 1)

  // Dominant type for transparency
  const types = [
    { name: 'retweet', val: input.retweets * ENGAGEMENT_WEIGHTS.retweet },
    { name: 'reply', val: input.replies * ENGAGEMENT_WEIGHTS.reply },
    { name: 'like', val: input.likes * ENGAGEMENT_WEIGHTS.like },
    { name: 'quote', val: (input.quotes ?? 0) * ENGAGEMENT_WEIGHTS.quote },
  ]
  const dominant = types.sort((a, b) => b.val - a.val)[0]?.name ?? 'none'

  // Logarithmic normalization: 0→0, 10→25, 100→50, 1000→75, 10000→100
  const score = Math.min(100, (Math.log10(Math.max(weighted, 1)) / 4) * 100)

  return { score, weighted, perView, dominant }
}

function calcEngagementVelocity(input: ViralityInput): {
  score: number; perHour: number; tier: string
} {
  const hoursOld = Math.max(
    (Date.now() - new Date(input.createdAt).getTime()) / (1000 * 60 * 60),
    0.01 // Prevent division by zero
  )

  const totalEngagement = input.likes + input.retweets + input.replies + (input.quotes ?? 0)
  const perHour = totalEngagement / hoursOld

  // Velocity scoring (calibrated for AI/tech niche):
  // 0-1/h = noise, 1-5/h = low, 5-20/h = medium, 20-100/h = high, 100+/h = viral
  let score: number
  let tier: string

  if (perHour >= 100) { score = 100; tier = 'viral' }
  else if (perHour >= 20) { score = 70 + (perHour - 20) / 80 * 30; tier = 'high' }
  else if (perHour >= 5) { score = 40 + (perHour - 5) / 15 * 30; tier = 'medium' }
  else if (perHour >= 1) { score = 15 + (perHour - 1) / 4 * 25; tier = 'low' }
  else { score = perHour * 15; tier = 'noise' }

  return { score: Math.min(100, score), perHour: Math.round(perHour * 10) / 10, tier }
}

function calcTimeFreshness(createdAt: string | Date): {
  score: number; hoursOld: number; decay: number
} {
  const hoursOld = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)

  // Exponential decay: e^(-λt) where λ = ln(2)/half_life
  const lambda = Math.LN2 / TIME_HALF_LIFE_HOURS
  const decay = Math.exp(-lambda * hoursOld)
  const score = 100 * decay

  return {
    score,
    hoursOld: Math.round(hoursOld * 10) / 10,
    decay: Math.round(decay * 1000) / 1000,
  }
}

function calcAuthorAuthority(input: ViralityInput): {
  score: number; followerScore: number; followRatio: number; verified: boolean
} {
  const followers = input.authorFollowers ?? 0
  const following = input.authorFollowing ?? 0
  const verified = input.authorVerified ?? false

  if (followers <= 0) return { score: 5, followerScore: 5, followRatio: 0, verified }

  // Logarithmic follower score: log10(n)/log10(ceiling) * 85
  const followerScore = Math.min(85,
    (Math.log10(Math.max(followers, 1)) / Math.log10(AUTHORITY_CEILING)) * 85
  )

  // Follow ratio bonus: followers/following > 10 = thought leader
  const followRatio = following > 0 ? followers / following : followers
  const ratioBonus = followRatio >= FOLLOWING_RATIO_THRESHOLD ? 10 :
    followRatio >= 3 ? 5 : 0

  const score = Math.min(100, followerScore + ratioBonus + (verified ? VERIFIED_BOOST : 0))

  return { score, followerScore: Math.round(followerScore), followRatio: Math.round(followRatio * 10) / 10, verified }
}

function calcContentRelevance(text: string, customKeywords?: string[]): {
  score: number; matched: string[]; points: number; tier: string
} {
  const lower = text.toLowerCase()
  const matched: string[] = []
  let points = 0

  const tiers = customKeywords
    ? [{ weight: 5, keywords: customKeywords.map(k => k.toLowerCase()) }]
    : RELEVANCE_TIERS

  for (const tier of tiers) {
    for (const kw of tier.keywords) {
      if (lower.includes(kw)) {
        matched.push(kw)
        points += tier.weight
      }
    }
  }

  // Normalize: 0→0, 5→30, 10→55, 15→75, 20+→90-100
  const score = Math.min(100, points <= 0 ? 0 :
    points <= 5 ? points * 6 :
    points <= 10 ? 30 + (points - 5) * 5 :
    points <= 15 ? 55 + (points - 10) * 4 :
    75 + Math.min(25, (points - 15) * 3)
  )

  const tier = score >= 75 ? 'core' : score >= 40 ? 'related' : score > 0 ? 'peripheral' : 'irrelevant'

  return { score, matched, points, tier }
}

function calcContentTypeSignal(input: ViralityInput): {
  score: number; multiplier: number; signals: string[]; domainBoost: number
} {
  const signals: string[] = []
  let multiplier = CONTENT_TYPE_MULTIPLIERS.textOnly

  const mediaTypes = input.mediaTypes ?? []

  if (mediaTypes.includes('video') || mediaTypes.includes('animated_gif')) {
    multiplier = Math.max(multiplier, CONTENT_TYPE_MULTIPLIERS.hasVideo)
    signals.push('video')
  }
  if (mediaTypes.includes('photo') || input.hasMedia) {
    multiplier = Math.max(multiplier, CONTENT_TYPE_MULTIPLIERS.hasImage)
    signals.push('image')
  }
  if (input.hasExternalLink || input.text.includes('https://')) {
    multiplier = Math.max(multiplier, CONTENT_TYPE_MULTIPLIERS.hasExternalLink)
    signals.push('link')
  }
  if (input.text.includes('🧵') || input.text.includes('thread') || input.text.includes('1/')) {
    multiplier = Math.max(multiplier, CONTENT_TYPE_MULTIPLIERS.hasThread)
    signals.push('thread')
  }
  if (signals.length === 0) signals.push('text_only')

  // Optimization 12: Source domain quality scoring
  let domainBoost = 0
  const urlRegex = /https?:\/\/([^\s/]+)/g
  let urlMatch: RegExpExecArray | null
  while ((urlMatch = urlRegex.exec(input.text)) !== null) {
    const domain = urlMatch[1].toLowerCase().replace(/^www\./, '')
    if (SPAM_DOMAINS.some(spam => domain.includes(spam))) {
      multiplier = 0.3
      domainBoost = -0.7
      signals.push(`spam_domain:${domain}`)
      break // Spam domain overrides everything
    }
    if (PREMIUM_DOMAINS.some(premium => domain.includes(premium))) {
      multiplier += 0.5
      domainBoost = 0.5
      signals.push(`premium_domain:${domain}`)
    }
  }

  // Normalize multiplier to 0-100 scale
  // 1.0 = 40 (baseline), 1.8 = 72, 2.5 = 100
  const score = Math.min(100, (multiplier / 2.5) * 100)

  return { score, multiplier, signals, domainBoost }
}

function calcCascadePotential(input: ViralityInput): {
  score: number; replyRatio: number; r0: number
} {
  const totalEngagement = input.likes + input.retweets + input.replies
  if (totalEngagement === 0) return { score: 5, replyRatio: 0, r0: 0 }

  // Reply-to-like ratio: high ratio = active discussion = cascade potential
  // X algorithm: reply chains valued at +75x
  const replyRatio = input.likes > 0 ? input.replies / input.likes : 0

  // Simplified R0 (basic reproduction number):
  // R0 = (retweets + quotes) / max(1, hours_old)
  // R0 > 1 = cascade growing, R0 < 1 = cascade dying
  const hoursOld = Math.max(
    (Date.now() - new Date(input.createdAt).getTime()) / (1000 * 60 * 60),
    0.1
  )
  const r0 = (input.retweets + (input.quotes ?? 0)) / hoursOld

  // Score: combination of reply ratio and R0
  // replyRatio > 0.3 = very active discussion
  // R0 > 5 = fast cascade growth
  const ratioScore = Math.min(50, replyRatio * 100)
  const r0Score = Math.min(50, (Math.log10(Math.max(r0, 0.1)) + 1) * 25)

  return {
    score: Math.min(100, Math.max(0, ratioScore + r0Score)),
    replyRatio: Math.round(replyRatio * 100) / 100,
    r0: Math.round(r0 * 100) / 100,
  }
}

function calcSentimentSignal(text: string): {
  score: number; positiveMatched: string[]; negativeMatched: string[]
} {
  const lower = text.toLowerCase()
  const positiveMatched: string[] = []
  const negativeMatched: string[] = []

  for (const signal of POSITIVE_SIGNALS) {
    if (lower.includes(signal)) positiveMatched.push(signal)
  }
  for (const signal of NEGATIVE_SIGNALS) {
    if (lower.includes(signal)) negativeMatched.push(signal)
  }

  // Start at 50 (neutral), +5 per positive (max 100), -10 per negative (min 0)
  const score = Math.min(100, Math.max(0,
    50 + (positiveMatched.length * 5) - (negativeMatched.length * 10)
  ))

  return { score, positiveMatched, negativeMatched }
}

// ══════════════════════════════════════════════════════════════════
// TIER CLASSIFICATION
// ══════════════════════════════════════════════════════════════════

function classifyTier(score: number): ViralityResult['tier'] {
  if (score >= 85) return 'viral'            // Top 2% — immediate curation priority
  if (score >= 70) return 'high_potential'    // Top 10% — strong candidate
  if (score >= 50) return 'above_average'     // Top 30% — worth considering
  if (score >= 30) return 'average'           // Middle 40% — filler content
  if (score >= 15) return 'below_average'     // Bottom 25% — low priority
  return 'noise'                              // Bottom 5% — skip
}

// ══════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ══════════════════════════════════════════════════════════════════

export function rankByVirality(
  tweets: ViralityInput[]
): Array<ViralityInput & { viralityScore: ViralityResult }> {
  return tweets
    .map(t => ({ ...t, viralityScore: calculateViralityScore(t) }))
    .sort((a, b) => b.viralityScore.score - a.viralityScore.score)
}

/**
 * Filter tweets by minimum virality tier.
 */
export function filterByMinTier(
  tweets: Array<ViralityInput & { viralityScore: ViralityResult }>,
  minTier: ViralityResult['tier'] = 'average'
): Array<ViralityInput & { viralityScore: ViralityResult }> {
  const tierOrder: Record<string, number> = {
    viral: 6, high_potential: 5, above_average: 4,
    average: 3, below_average: 2, noise: 1,
  }
  const minLevel = tierOrder[minTier] ?? 0
  return tweets.filter(t => (tierOrder[t.viralityScore.tier] ?? 0) >= minLevel)
}
