export interface TrendStyleStatLike {
  style: string | null
  hook_pattern: string | null
  topic_category: string | null
  posts_count: number | null
  avg_reach: number | null
  avg_likes: number | null
  avg_saves: number | null
  avg_shares: number | null
  avg_prompt_requests: number | null
  delivery_rate: number | null
}

export interface TrendLearningPreference {
  style: string
  topicCategory: string
  hookPattern: string
  score: number
  reasons: string[]
}

export interface TrendHistoricalDecisionLike {
  topicCategory: string | null
  editorialTemplateId: string | null
  editorialTemplateLabel: string | null
  videoProvider: string | null
  providerModel: string | null
  generationMode: string | null
  reach: number | null
  likes: number | null
  saves: number | null
  shares: number | null
  promptRequests: number | null
  deliveryRate: number | null
}

export interface TrendVideoLearningPreference {
  editorialTemplateId: string
  editorialTemplateLabel: string
  videoProvider: string
  providerModel: string
  generationMode: string
  score: number
  reasons: string[]
}

export interface TrendLearningPack {
  topStyles: string[]
  topHookPatterns: string[]
  preferredStyle: string | null
  preferredHookPattern: string | null
  topPreference: TrendLearningPreference | null
  preferredEditorialTemplateId: string | null
  preferredEditorialTemplateLabel: string | null
  preferredVideoProvider: string | null
  preferredVideoModel: string | null
  preferredGenerationMode: string | null
  topVideoPreference: TrendVideoLearningPreference | null
  topVideoPreferences: TrendVideoLearningPreference[]
}

export interface AdaptiveTrendTopicInput {
  topic: string
  category: string
  relatedText?: string
  baseTrendScore: number
  visualPotential?: number
  emotionalPotential?: number
  shortViralFit?: number
  learning: TrendLearningPack
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function scoreTrendLearningPreference(row: TrendStyleStatLike): TrendLearningPreference {
  const postsCount = Math.max(1, toNumber(row.posts_count))
  const reach = toNumber(row.avg_reach)
  const likes = toNumber(row.avg_likes)
  const saves = toNumber(row.avg_saves)
  const shares = toNumber(row.avg_shares)
  const promptRequests = toNumber(row.avg_prompt_requests)
  const deliveryRate = toNumber(row.delivery_rate)

  const score = Number((
    Math.min(reach / 10000, 8) * 0.35 +
    Math.min((likes + saves * 2 + shares * 3) / 500, 6) * 0.25 +
    Math.min(promptRequests / 8, 5) * 0.2 +
    Math.min(deliveryRate / 25, 4) * 0.15 +
    Math.min(postsCount / 4, 2) * 0.05
  ).toFixed(2))

  const reasons: string[] = []
  if (reach >= 10000) reasons.push('reach_forte')
  if (shares >= 100) reasons.push('share_forte')
  if (promptRequests >= 5) reasons.push('prompt_forte')
  if (deliveryRate >= 25) reasons.push('delivery_forte')
  if (postsCount >= 3) reasons.push('amostra_confiavel')

  return {
    style: row.style?.trim() || 'default',
    topicCategory: row.topic_category?.trim() || 'general',
    hookPattern: row.hook_pattern?.trim() || 'default',
    score,
    reasons,
  }
}

export function buildTrendLearningPack(
  rows: TrendStyleStatLike[],
  decisions: TrendHistoricalDecisionLike[],
  topicCategory: string,
): TrendLearningPack {
  const scored = rows
    .filter((row) => (row.topic_category?.trim() || 'general') === topicCategory)
    .map(scoreTrendLearningPreference)
    .sort((a, b) => b.score - a.score)

  const topPreference = scored[0] ?? null
  const topStyles = [...new Set(scored.map((item) => item.style))].slice(0, 3)
  const topHookPatterns = [...new Set(scored.map((item) => item.hookPattern))].slice(0, 3)
  const scoredDecisions = decisions
    .filter((item) => (item.topicCategory?.trim() || 'general') === topicCategory)
    .map(scoreTrendVideoLearningPreference)
    .sort((a, b) => b.score - a.score)
  const topVideoPreference = scoredDecisions[0] ?? null

  return {
    topStyles,
    topHookPatterns,
    preferredStyle: topPreference?.style ?? null,
    preferredHookPattern: topPreference?.hookPattern ?? null,
    topPreference,
    preferredEditorialTemplateId: topVideoPreference?.editorialTemplateId ?? null,
    preferredEditorialTemplateLabel: topVideoPreference?.editorialTemplateLabel ?? null,
    preferredVideoProvider: topVideoPreference?.videoProvider ?? null,
    preferredVideoModel: topVideoPreference?.providerModel ?? null,
    preferredGenerationMode: topVideoPreference?.generationMode ?? null,
    topVideoPreference,
    topVideoPreferences: scoredDecisions.slice(0, 3),
  }
}

export function classifyTrendVideoModelMode(model: string | null | undefined): string | null {
  const normalized = model?.trim().toLowerCase() || ''
  if (!normalized) return null
  if (normalized.includes('seedance') || normalized.includes('kling')) return 'prompt_video'
  if (normalized.includes('dop')) return 'image_to_video'
  return null
}

export function scoreTrendVideoLearningPreference(row: TrendHistoricalDecisionLike): TrendVideoLearningPreference {
  const reach = toNumber(row.reach)
  const likes = toNumber(row.likes)
  const saves = toNumber(row.saves)
  const shares = toNumber(row.shares)
  const promptRequests = toNumber(row.promptRequests)
  const deliveryRate = toNumber(row.deliveryRate)

  const score = Number((
    Math.min(reach / 10000, 8) * 0.35 +
    Math.min((likes + saves * 2 + shares * 3) / 500, 6) * 0.3 +
    Math.min(promptRequests / 8, 5) * 0.2 +
    Math.min(deliveryRate / 25, 4) * 0.15
  ).toFixed(2))

  const reasons: string[] = []
  if (reach >= 10000) reasons.push('reach_forte')
  if (shares >= 100) reasons.push('share_forte')
  if (promptRequests >= 5) reasons.push('prompt_forte')
  if (deliveryRate >= 25) reasons.push('delivery_forte')

  return {
    editorialTemplateId: row.editorialTemplateId?.trim() || 'luxo_cinema',
    editorialTemplateLabel: row.editorialTemplateLabel?.trim() || 'Luxo cinema',
    videoProvider: row.videoProvider?.trim() || 'higgsfield',
    providerModel: row.providerModel?.trim() || 'dop-preview',
    generationMode: row.generationMode?.trim() || classifyTrendVideoModelMode(row.providerModel) || 'image_to_video',
    score,
    reasons,
  }
}

export function applyLearnedStyleRotation(
  styleRotation: string[],
  learnedStyles: string[],
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const item of [...learnedStyles, ...styleRotation]) {
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    merged.push(normalized)
  }

  return merged
}

function countKeywordHits(text: string, patterns: string[]): number {
  let hits = 0
  for (const pattern of patterns) {
    if (text.includes(pattern)) hits += 1
  }
  return hits
}

export function scoreAdaptiveTrendTopic(input: AdaptiveTrendTopicInput): number {
  const text = `${input.topic} ${input.relatedText ?? ''}`.toLowerCase()
  let boost = 0

  const hookPattern = input.learning.preferredHookPattern?.toLowerCase() || ''
  if (hookPattern) {
    const hookTokens = hookPattern.split(/\s+/).filter((token) => token.length >= 4)
    boost += Math.min(countKeywordHits(text, hookTokens) * 1.5, 4)
  }

  const templateId = input.learning.preferredEditorialTemplateId || ''
  if (templateId === 'futebol_absurdo' && /\b(gol|torcida|final|estadio|estádio|jogada|arena|camisa)\b/.test(text)) boost += 5
  if ((templateId === 'ia_inacreditavel' || templateId === 'tech_futurista') && /\b(ia|ai|robo|robô|modelo|avatar|chip|app|futuro|claude|openai|chatgpt)\b/.test(text)) boost += 5
  if (templateId === 'curiosidade_pop' && /\b(cena|bastidor|show|viral|internet|celebridade|netflix|estreia)\b/.test(text)) boost += 5
  if (templateId === 'anime_hype' && /\b(anime|manga|cosplay|episodio|otaku|frame)\b/.test(text)) boost += 5
  if (templateId === 'luxo_cinema' && /\b(cena|filme|poster|luxo|cinema|visual)\b/.test(text)) boost += 4

  const generationMode = input.learning.preferredGenerationMode || ''
  if (generationMode === 'prompt_video') {
    boost += Math.min((input.visualPotential ?? 0) / 6, 3)
    boost += Math.min((input.emotionalPotential ?? 0) / 8, 2)
  }

  if (input.learning.topVideoPreference?.score && input.learning.topVideoPreference.score >= 3) {
    boost += 1.5
  }

  return Number(Math.min(100, input.baseTrendScore + boost).toFixed(2))
}
