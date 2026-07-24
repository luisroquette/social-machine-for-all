/**
 * Pre-publish quality gate — final check before content goes live.
 * Port of v1's capataz-publicacao pre-publish gate.
 */

import { checkGuardrailsSync } from '@/lib/brand/guardrails'
import { type PlatformConfig } from '@/lib/settings/platform-config'

export interface QualityCheckResult {
  passed: boolean
  score: number
  issues: string[]
  warnings: string[]
}

type StructuredPost = {
  format?: string
  caption?: string
  headline?: string
  context?: string
  kpi?: string
  slides?: Array<{
    type?: string
    headline?: string
    body?: string
    context?: string
    kpi?: string
  }>
}

const VAGUE_PROMISE_PATTERNS = [
  /\b(?:videos?|conteudos?|novidades?|momentos?|destaques?)\s+(?:recentes?|interessantes?|incriveis?)\b/i,
  /\b(?:isso|aquilo|essa novidade|essas novidades|o que aconteceu)\b/i,
  /\b(?:veja|confira|descubra|entenda)\s+(?:isso|mais|tudo|agora)\b/i,
]

function parseStructuredPost(content: string): StructuredPost | null {
  try {
    const parsed = JSON.parse(content) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as StructuredPost
      : null
  } catch {
    return null
  }
}

export function getPublishableContentText(content: string): string {
  return parseStructuredPost(content)?.caption?.trim() || content
}

function meaningfulSlideText(slide: NonNullable<StructuredPost['slides']>[number]): string {
  return [slide.headline, slide.body, slide.context, slide.kpi]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .trim()
}

function hasConcreteDetail(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  return /\d/.test(text) || words.length >= 9
}

function runStructuredChecks(post: StructuredPost, issues: string[], warnings: string[]): number {
  let penalty = 0
  const caption = post.caption?.trim() ?? ''
  const headline = post.headline?.trim() ?? post.slides?.[0]?.headline?.trim() ?? ''
  const format = post.format?.toLowerCase()

  if (!caption) {
    issues.push('Conteúdo estruturado sem legenda')
    penalty += 5
  } else if (caption.length < 80) {
    warnings.push('Legenda curta: confirmar se o contexto está completo')
    penalty += 1
  }

  if (headline && VAGUE_PROMISE_PATTERNS.some((pattern) => pattern.test(headline))) {
    warnings.push('Capa potencialmente vaga: confirmar se slides e legenda identificam o assunto')
    penalty += 1
  }

  if (format === 'carousel') {
    const slides = Array.isArray(post.slides) ? post.slides : []
    if (slides.length < 2) {
      issues.push('Carrossel precisa ter pelo menos 2 slides')
      penalty += 5
      return penalty
    }

    if (slides[0]?.type !== 'cover') {
      issues.push('Primeiro slide do carrossel precisa ser a capa')
      penalty += 2
    }

    const emptySlides = slides.filter((slide) => !slide.headline?.trim())
    if (emptySlides.length > 0) {
      issues.push(`${emptySlides.length} slide(s) sem headline`)
      penalty += 3
    }

    const deliverySlides = slides.slice(1).filter((slide) => hasConcreteDetail(meaningfulSlideText(slide)))
    if (deliverySlides.length === 0) {
      issues.push('Promessa da capa não é entregue por nenhum slide concreto')
      penalty += 5
    }

    const normalizedSlides = slides.map((slide) => meaningfulSlideText(slide).toLowerCase())
    if (new Set(normalizedSlides.filter(Boolean)).size < Math.min(2, slides.length)) {
      issues.push('Carrossel sem progressão: slides repetitivos ou sem conteúdo distinto')
      penalty += 3
    }
  } else {
    const contextText = post.context?.trim() ?? ''
    const kpiText = post.kpi?.trim() ?? ''

    if (!contextText && !hasConcreteDetail(caption)) {
      issues.push('Post não apresenta contexto ou detalhe concreto')
      penalty += 3
    }

    // O writer é instruído a escrever "1-2 frases" para context (renderizado como
    // corpo de texto na imagem, não só na legenda). Sem este teto, um parágrafo
    // inteiro vira "wall of text" no post — reproduzido em produção 2026-07-19.
    const MAX_CONTEXT_CHARS = 220
    if (contextText.length > MAX_CONTEXT_CHARS) {
      issues.push(`Contexto longo demais para a imagem: ${contextText.length} chars (max ${MAX_CONTEXT_CHARS} — deve ser 1-2 frases)`)
      penalty += 3
    }

    // Vazamento de metadado interno de priorização (editorial_priority_score,
    // launch_score etc.) para um campo público — reproduzido em produção
    // 2026-07-19: kpi = "Prioridade editorial 85 | Score 50 | Ângulo: ... | Selo: ...".
    // O writer usa esses campos como CONTEXTO de entrada para julgar relevância;
    // eles nunca devem aparecer verbatim no post publicado.
    const INTERNAL_METADATA_PATTERN = /prioridade editorial|editorial_priority|launch_score|launch_categor|\bângulo:\s|\bselo:\s/i
    if (INTERNAL_METADATA_PATTERN.test(kpiText) || INTERNAL_METADATA_PATTERN.test(contextText)) {
      issues.push('Metadado interno de pipeline vazou para campo público (kpi/context)')
      penalty += 5
    }
  }

  return penalty
}

/**
 * Run quality checks on content before publishing.
 */
export function runQualityGate(content: string, platform: string, platformConfig?: PlatformConfig): QualityCheckResult {
  const issues: string[] = []
  const warnings: string[] = []
  let score = 10
  const structuredPost = parseStructuredPost(content)
  const publishableText = getPublishableContentText(content)

  if (structuredPost) {
    score -= runStructuredChecks(structuredPost, issues, warnings)
  }

  // Check guardrails (sync version uses cached patterns)
  // Pass allowHashtags from platform config so hashtag-friendly platforms aren't penalized
  const violations = checkGuardrailsSync(publishableText, { allowHashtags: platformConfig?.allowHashtags ?? false })
  if (violations.length > 0) {
    issues.push(`Guardrail violations: ${violations.join(', ')}`)
    score -= violations.length * 2
  }

  // Empty content
  if (!publishableText.trim()) {
    issues.push('Empty content')
    score = 0
  }

  // Platform-aware length checks
  const maxLength = platformConfig?.maxLength ?? 280
  const allowHashtags = platformConfig?.allowHashtags ?? false

  if (publishableText.length > maxLength) {
    issues.push(`Exceeds ${maxLength} chars: ${publishableText.length}`)
    score -= 3
  }

  // Minimum length check (platform-aware)
  const minLength = platform === 'x' ? 20 : 50
  if (publishableText.trim().length > 0 && publishableText.length < minLength) {
    if (publishableText.length < 20) {
      issues.push(`Too short: ${publishableText.length} chars (min 20)`)
      score -= 3
    } else {
      warnings.push(`Short content: ${publishableText.length} chars (recommended ${minLength})`)
      score -= 1
    }
  }

  // Hashtag checks
  if (!allowHashtags) {
    const hashtagCount = (publishableText.match(/#\w+/g) ?? []).length
    if (hashtagCount > 0) {
      issues.push(`Hashtags not allowed: ${hashtagCount} found`)
      score -= 2
    }
  } else {
    // Even on hashtag-friendly platforms, cap excessive usage
    const maxHashtags = platformConfig?.maxHashtags ?? 20
    const hashtagCount = (publishableText.match(/#\w+/g) ?? []).length
    if (hashtagCount > maxHashtags) {
      warnings.push(`Too many hashtags: ${hashtagCount} (recommended max ${maxHashtags})`)
      score -= 1
    }
  }

  // requireImage: publisher handles image fetching — don't block here

  // Excessive caps
  const capsRatio = (publishableText.match(/[A-Z]/g)?.length ?? 0) / Math.max(publishableText.length, 1)
  if (capsRatio > 0.4 && publishableText.length > 20) {
    warnings.push('Excessive use of capital letters')
    score -= 1
  }

  return {
    passed: score >= 6 && issues.length === 0,
    score: Math.max(0, Math.min(10, score)),
    issues,
    warnings,
  }
}
