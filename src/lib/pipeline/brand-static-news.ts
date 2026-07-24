import type { brandBrazilLaunchCategory, brandBrazilLaunchResult } from './brand-brazil-launch'
import { evaluatebrandBrazilLaunch } from './brand-brazil-launch'

export type StaticNewsMediaMode = 'curated_image' | 'generated_image'

export type StaticNewsCandidateInput = {
  id: string
  workspace_id: string
  source_platform: string
  source_url: string | null
  source_author: string | null
  source_content: string
  source_metrics: Record<string, unknown> | null
  relevance_score: number | null
}

export type StaticNewsCandidate = {
  curated_content_id: string
  workspace_id: string
  source_platform: string
  source_url: string | null
  source_author: string | null
  source_content: string
  source_metrics: Record<string, unknown> | null
  launch_category: brandBrazilLaunchCategory
  launch_score: number
  launch_reasons: string[]
  media_mode: StaticNewsMediaMode
  image_urls: string[]
  primary_image_url: string | null
  metadata: {
    brazil_launch: brandBrazilLaunchResult
    source_relevance_score: number
    editorial_priority_score: number
    b2b_angle: StaticNewsB2BAngle
    visual_selection?: Array<Record<string, unknown>>
  }
}

export type StaticNewsQueueItem = {
  id: string
  curated_content_id: string
  workspace_id: string
  source_platform: string
  source_url: string | null
  source_author: string | null
  source_content: string
  source_metrics: Record<string, unknown> | null
  launch_category: brandBrazilLaunchCategory
  launch_score: number
  launch_reasons: string[]
  media_mode: StaticNewsMediaMode
  image_urls: string[]
  primary_image_url: string | null
  metadata?: {
    editorial_priority_score?: number
    b2b_angle?: StaticNewsB2BAngle
  } | null
}

export type StaticNewsDraft = {
  target_format: 'feed_post' | 'carousel'
  content: string
}

export type StaticNewsVisualLabel = 'BRASIL' | 'PRECO' | 'VENDAS' | 'PRODUCAO'

export type StaticNewsB2BAngle =
  | 'infraestrutura'
  | 'frota'
  | 'recarga_destino'
  | 'varejo_postos'

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|avif)(\?|$)/i.test(url)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function scoreStaticImageUrl(url: string): number {
  const normalized = url.toLowerCase()
  let score = 0

  if (/\b(car|auto|vehicle|sedan|suv|ev|phev|hybrid|byd|geely|chery|mg|bmw|volvo|tesla)\b/.test(normalized)) score += 20
  if (/\b(front|rear|side|interior|cockpit|hero|exterior)\b/.test(normalized)) score += 12
  if (/\b(thumbnail|thumb|profile|avatar|icon|logo|banner|emoji|sticker|story|screenshot|print|cover)\b/.test(normalized)) score -= 25
  if (/\b(text|headline|caption|quote|meme|poster|ad)\b/.test(normalized)) score -= 18
  if (isImageUrl(url)) score += 5

  return score
}

export function selectCuratedStaticImageUrls(urls: string[]): string[] {
  return unique(urls)
    .map((url, index) => ({ url, index, score: scoreStaticImageUrl(url) - index }))
    .filter((item) => item.score > -10)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.url)
}

export function getStaticNewsVisualLabel(category: brandBrazilLaunchCategory): StaticNewsVisualLabel {
  if (category === 'price_brazil') return 'PRECO'
  if (category === 'sales_brazil') return 'VENDAS'
  if (category === 'production_brazil') return 'PRODUCAO'
  return 'BRASIL'
}

export function extractStaticImageUrls(sourcePlatform: string, metrics: Record<string, unknown> | null): string[] {
  if (!metrics) return []

  const mediaUrls = Array.isArray(metrics.media_urls) ? metrics.media_urls.filter((v): v is string => typeof v === 'string') : []
  const mediaTypes = Array.isArray(metrics.media_types) ? metrics.media_types.filter((v): v is string => typeof v === 'string') : []
  const thumbnailUrl = typeof metrics.thumbnailUrl === 'string' ? metrics.thumbnailUrl : null

  const imageCandidates = mediaUrls.filter((url, index) => {
    const mediaType = mediaTypes[index]?.toLowerCase() ?? ''
    if (mediaType.startsWith('image')) return true
    if (mediaType === 'photo') return true
    return isImageUrl(url)
  })

  if (thumbnailUrl && (sourcePlatform === 'youtube' || sourcePlatform === 'instagram' || isImageUrl(thumbnailUrl))) {
    imageCandidates.push(thumbnailUrl)
  }

  return unique(imageCandidates)
}

export function materializeStaticNewsCandidate(input: StaticNewsCandidateInput): StaticNewsCandidate | null {
  const launch = evaluatebrandBrazilLaunch(input.source_content)
  if (!launch.eligible) return null
  if (launch.category === 'non_vehicle_market_story') return null

  const imageUrls = selectCuratedStaticImageUrls(extractStaticImageUrls(input.source_platform, input.source_metrics))
  const mediaMode: StaticNewsMediaMode = imageUrls.length > 0 ? 'curated_image' : 'generated_image'
  const normalized = input.source_content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const b2bAngle = inferStaticNewsB2BAngle(normalized, launch.category)
  const editorialPriorityScore = computeStaticNewsEditorialPriority({
    launchScore: launch.score,
    sourceRelevanceScore: input.relevance_score ?? 0,
    imageCount: imageUrls.length,
    b2bAngle,
    launchCategory: launch.category,
    text: normalized,
  })

  return {
    curated_content_id: input.id,
    workspace_id: input.workspace_id,
    source_platform: input.source_platform,
    source_url: input.source_url,
    source_author: input.source_author,
    source_content: input.source_content,
    source_metrics: input.source_metrics,
    launch_category: launch.category,
    launch_score: launch.score,
    launch_reasons: launch.reasons,
    media_mode: mediaMode,
    image_urls: imageUrls,
    primary_image_url: imageUrls[0] ?? null,
    metadata: {
      brazil_launch: launch,
      source_relevance_score: input.relevance_score ?? 0,
      editorial_priority_score: editorialPriorityScore,
      b2b_angle: b2bAngle,
    },
  }
}

export function inferStaticNewsB2BAngle(text: string, category: brandBrazilLaunchCategory): StaticNewsB2BAngle {
  if (category === 'production_brazil' || hasAny(text, ['fabrica', 'fabrica local', 'producao local', 'produção local', 'montadora'])) {
    return 'infraestrutura'
  }
  if (hasAny(text, ['frota', 'logistica', 'logística', 'corporativ', 'operacao'])) {
    return 'frota'
  }
  if (hasAny(text, ['shopping', 'condominio', 'condomínio', 'estacionamento', 'hotel', 'supermercado'])) {
    return 'recarga_destino'
  }
  if (hasAny(text, ['posto', 'varejo', 'concessionaria', 'concessionária'])) {
    return 'varejo_postos'
  }
  if (category === 'sales_brazil' || category === 'price_brazil') {
    return 'frota'
  }
  return 'infraestrutura'
}

export function computeStaticNewsEditorialPriority(input: {
  launchScore: number
  sourceRelevanceScore: number
  imageCount: number
  b2bAngle: StaticNewsB2BAngle
  launchCategory: brandBrazilLaunchCategory
  text: string
}): number {
  let score = input.launchScore + Math.round(input.sourceRelevanceScore * 0.35)
  if (input.imageCount >= 2) score += 10
  else if (input.imageCount === 1) score += 5

  if (input.launchCategory === 'sales_brazil') score += 15
  else if (input.launchCategory === 'price_brazil') score += 12
  else if (input.launchCategory === 'production_brazil') score += 10
  else if (input.launchCategory === 'launch_brazil') score += 8

  if (input.b2bAngle === 'frota') score += 10
  else if (input.b2bAngle === 'infraestrutura') score += 8
  else if (input.b2bAngle === 'varejo_postos') score += 6
  else if (input.b2bAngle === 'recarga_destino') score += 5

  if (hasAny(input.text, ['r$', 'preco', 'preço'])) score += 8
  if (hasAny(input.text, ['inicio de vendas', 'início de vendas', 'vendas no brasil'])) score += 8
  if (hasAny(input.text, ['fabricado no brasil', 'producao local', 'produção local'])) score += 6

  return score
}

export function chooseStaticNewsDraftFormat(item: StaticNewsQueueItem): 'feed_post' | 'carousel' {
  return item.media_mode === 'curated_image' && item.image_urls.length > 1 ? 'carousel' : 'feed_post'
}

export function buildStaticNewsPrompt(item: StaticNewsQueueItem, targetFormat: 'feed_post' | 'carousel'): string {
  const visualLabel = getStaticNewsVisualLabel(item.launch_category)
  const mediaInstruction = item.media_mode === 'curated_image'
    ? `Use a imagem original curada como mídia principal. Monte uma peça editorial da Brand em cima dessa imagem. Inclua também um image_prompt de fallback caso a mídia curada falhe.`
    : `Não há imagem curada válida. Gere um draft que dependa de imagem gerada pela Brand.`

  const formatInstruction = item.media_mode === 'curated_image' && targetFormat === 'feed_post'
    ? `Retorne JSON com:
{
  "format": "feed_post",
  "visual_mode": "curated_image",
  "eyebrow": "${visualLabel}",
  "headline": "...",
  "context": "...",
  "kpi": "...",
  "image_prompt": "...",
  "caption": "..."
}`
    : item.media_mode === 'curated_image'
      ? `Retorne JSON com:
{
  "format": "carousel",
  "visual_mode": "curated_image",
  "eyebrow": "${visualLabel}",
  "image_prompt": "...",
  "caption": "...",
  "slides": [
    { "type": "cover", "headline": "...", "context": "...", "kpi": "..." },
    { "type": "content", "headline": "...", "body": "...", "kpi": "..." }
  ]
}

REGRAS DO CARROSSEL:
- Gere exatamente ${item.image_urls.length} slides.
- Slide 1 = hook/cover.
- Slides intermediários = leitura de mercado, operação, recarga, frota ou pressão de infraestrutura.
- Último slide = leitura B2B ou CTA comercial da Brand.
- Cada slide deve caber visualmente sobre uma foto do carro.`
    : `Retorne JSON com:
{
  "format": "feed_post",
  "headline": "...",
  "context": "...",
  "kpi": "...",
  "image_prompt": "...",
  "caption": "..."
}`

  return [
    'Você escreve drafts do Instagram da Brand sobre lançamentos de veículos elétricos e híbridos no Brasil.',
    'Objetivo: reinterpretar a notícia como oportunidade B2B para infraestrutura de recarga, frotas, estacionamentos, varejo, condomínios ou postos.',
    'NUNCA tratar a pauta como notícia automotiva pura.',
    'Conectar sempre com infraestrutura, operação, recarga, gargalo de rede ou oportunidade comercial.',
    mediaInstruction,
    `Categoria: ${item.launch_category}`,
    `Selo visual: ${visualLabel}`,
    `Score: ${item.launch_score}`,
    `Motivos: ${item.launch_reasons.join(', ')}`,
    `Angulo B2B prioritario: ${item.metadata?.b2b_angle ?? 'infraestrutura'}`,
    `Prioridade editorial: ${item.metadata?.editorial_priority_score ?? item.launch_score}`,
    '',
    'REGRAS:',
    '- Só usar fatos explicitamente presentes na fonte.',
    '- Nada de China/global se a pauta é Brasil.',
    '- Nada de rumor ou especulação.',
    '- Abrir com implicação comercial/operacional, não com ficha técnica do carro.',
    '- CTA final sempre comercial e alinhado à Brand.',
    '- Tom: executivo, direto, B2B, sem hype adolescente.',
    '- Caption em PT-BR.',
    '',
    formatInstruction,
    '',
    'FONTE:',
    item.source_content,
    item.source_url ? `URL: ${item.source_url}` : '',
  ].filter(Boolean).join('\n')
}
