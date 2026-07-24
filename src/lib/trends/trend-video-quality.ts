import { evaluateTrendSafety } from './trend-safety'
import {
  TREND_VIDEO_QUALITY_MAX_ISSUES,
  TREND_VIDEO_QUALITY_MIN_CAPTION_CHARS,
  TREND_VIDEO_QUALITY_MIN_SHOTS,
  TREND_VIDEO_QUALITY_MIN_TOTAL_DURATION_SEC,
  TREND_VIDEO_QUALITY_MIN_UNIQUE_INTENT_TARGET,
  TREND_VIDEO_QUALITY_MIN_UNIQUE_STYLE_TARGET,
  TREND_VIDEO_QUALITY_PASS_SCORE,
} from './trend-video-quality-config'

type JsonObject = Record<string, unknown>

export interface TrendVideoQualityResult {
  passed: boolean
  score: number
  issues: string[]
  criticalIssues: string[]
  metrics: {
    totalDurationSec: number
    shotCount: number
    uniqueStyles: number
    uniqueVisualIntents: number
    subtleMotionHits: number
  }
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function collectShots(raw: unknown): JsonObject[] {
  return Array.isArray(raw) ? raw.map((item) => asObject(item)).filter(Boolean) as JsonObject[] : []
}

function collectSegments(shot: JsonObject): JsonObject[] {
  return Array.isArray(shot.segments)
    ? shot.segments.map((item) => asObject(item)).filter(Boolean) as JsonObject[]
    : []
}

function hasWeakTitlePattern(value: string): boolean {
  const cleaned = value.trim()
  if (cleaned.length < 18) return true
  if (/^por que .+ esta bombando$/i.test(cleaned)) return true
  if (/^[A-Z0-9\s]+$/.test(cleaned) && cleaned.split(/\s+/).length < 4) return true
  return false
}

export function runTrendVideoQualityGate(input: {
  topic?: string | null
  category?: string | null
  hookTitle: string
  coverTitle: string
  caption: string
  angle?: string | null
  coverUrl?: string | null
  shotResults?: unknown
  generationMemory?: JsonObject | null
}): TrendVideoQualityResult {
  const issues: string[] = []
  const criticalIssues: string[] = []
  let score = 10

  const safety = evaluateTrendSafety({
    topic: input.topic ?? input.coverTitle,
    category: input.category ?? 'general',
    relatedText: [input.hookTitle, input.caption, input.angle ?? ''].join(' '),
  })
  if (safety.status === 'blocked') {
    criticalIssues.push(`safety_blocked:${safety.flags.join(',')}`)
    score = 0
  }

  const shots = collectShots(input.shotResults)
  const shotCount = shots.length
  const totalDurationSec = Number(
    shots.reduce((sum, shot) => {
      const segments = collectSegments(shot)
      if (segments.length > 0) {
        return sum + segments.reduce((segmentSum, segment) => segmentSum + (Number(segment.durationSec) || 0), 0)
      }
      return sum + (Number(shot.durationSec) || 0)
    }, 0).toFixed(2),
  )
  const uniqueStyles = new Set(
    shots.map((shot) => String(shot.visualStyle ?? '').trim().toLowerCase()).filter(Boolean),
  ).size
  const uniqueVisualIntents = new Set(
    shots.map((shot) => String(shot.visualIntent ?? '').trim().toLowerCase()).filter(Boolean),
  ).size

  const subtleMotionHits = shots.flatMap((shot) => {
    const prompts = [
      String(shot.motionPrompt ?? ''),
      ...collectSegments(shot).map((segment) => String(segment.motionPrompt ?? '')),
    ]
    return prompts.filter((prompt) =>
      /\b(subtle|gentle|slight|breathing image|parallax|idle animation|slow zoom only|foto respirando|parallax sutil)\b/i.test(prompt),
    )
  }).length

  if (!input.coverUrl || !input.generationMemory?.coverBaseImage) {
    issues.push('cover_generation_missing')
    score -= 2
  }

  if (totalDurationSec < TREND_VIDEO_QUALITY_MIN_TOTAL_DURATION_SEC) {
    criticalIssues.push(`video_too_short:${totalDurationSec}s`)
    score -= 3
  }

  if (shotCount < TREND_VIDEO_QUALITY_MIN_SHOTS) {
    criticalIssues.push(`not_enough_shots:${shotCount}`)
    score -= 3
  }

  if (uniqueStyles < Math.min(TREND_VIDEO_QUALITY_MIN_UNIQUE_STYLE_TARGET, shotCount)) {
    issues.push(`low_style_diversity:${uniqueStyles}`)
    score -= 2
  }

  if (uniqueVisualIntents < Math.min(TREND_VIDEO_QUALITY_MIN_UNIQUE_INTENT_TARGET, shotCount)) {
    issues.push(`low_visual_change:${uniqueVisualIntents}`)
    score -= 2
  }

  if (subtleMotionHits > 0) {
    criticalIssues.push(`photo_loop_risk:${subtleMotionHits}`)
    score -= 3
  }

  if (hasWeakTitlePattern(input.coverTitle)) {
    issues.push('weak_cover_title')
    score -= 1
  }

  if (hasWeakTitlePattern(input.hookTitle)) {
    issues.push('weak_hook_title')
    score -= 1
  }

  if (input.caption.trim().length < TREND_VIDEO_QUALITY_MIN_CAPTION_CHARS) {
    issues.push('caption_too_short')
    score -= 1
  }

  return {
    passed: criticalIssues.length === 0 && score >= TREND_VIDEO_QUALITY_PASS_SCORE && issues.length <= TREND_VIDEO_QUALITY_MAX_ISSUES,
    score: Math.max(0, Math.min(10, score)),
    issues,
    criticalIssues,
    metrics: {
      totalDurationSec,
      shotCount,
      uniqueStyles,
      uniqueVisualIntents,
      subtleMotionHits,
    },
  }
}
