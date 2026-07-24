type JsonObject = Record<string, unknown>

interface GiveawayShot {
  shotId?: string
  label?: string
  styleRole?: string
  visualStyle?: string
  styleDirection?: string
  visualIntent?: string
  subjectAction?: string
  environmentAction?: string
  cameraMove?: string
  lens?: string
  framing?: string
  lightShift?: string
  transition?: string
  payoff?: string
  rhythm?: string
  motionPrompt?: string
  durationSec?: number
  clipUrl?: string | null
  providerJobId?: string | null
  videoGeneration?: JsonObject | null
}

interface BuildTrendGiveawayInput {
  jobId: string
  trendTopicId?: string | null
  style: string
  angle: string
  hookTitle: string
  coverTitle: string
  caption: string
  ctaText: string
  imagePrompt: string
  motionPrompt: string
  imageProvider?: string | null
  videoProvider?: string | null
  providerModel?: string | null
  baseImageUrl?: string | null
  coverUrl?: string | null
  videoUrl?: string | null
  generationMemory?: JsonObject | null
  shotResults?: GiveawayShot[]
}

function normalizeKeywordCandidate(value: string): string {
  return value.replace(/["'“”‘’.,!?]/g, '').trim().toUpperCase()
}

export function extractGiveawayKeyword(ctaText: string, fallback = 'PROMPT'): string {
  const quoted = ctaText.match(/["“”']\s*([A-Za-z0-9_-]{2,24})\s*["“”']/)
  if (quoted?.[1]) return normalizeKeywordCandidate(quoted[1])

  const commentVerb = ctaText.match(/comente(?:\s+aqui)?\s+([A-Za-z0-9_-]{2,24})/i)
  if (commentVerb?.[1]) return normalizeKeywordCandidate(commentVerb[1])

  return normalizeKeywordCandidate(fallback)
}

function clipText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trim()}…`
}

function getLastAttempt(videoGeneration: JsonObject | null | undefined): JsonObject | undefined {
  const attempts = videoGeneration?.attempts
  if (!Array.isArray(attempts) || attempts.length === 0) return undefined
  return attempts[attempts.length - 1] as JsonObject
}

function buildAssetManifest(input: BuildTrendGiveawayInput): JsonObject[] {
  const assets: JsonObject[] = []

  if (input.baseImageUrl) {
    const baseGeneration = input.generationMemory?.coverBaseImage as JsonObject | undefined
    assets.push({
      kind: 'cover_base_image',
      provider: baseGeneration?.provider ?? input.imageProvider ?? 'openai',
      model: baseGeneration?.model ?? input.imageProvider ?? 'openai',
      prompt: baseGeneration?.promptFinal ?? input.imagePrompt,
      promptOriginal: baseGeneration?.promptOriginal ?? input.imagePrompt,
      negativePrompt: baseGeneration?.negativePrompt ?? null,
      seed: baseGeneration?.seed ?? null,
      params: baseGeneration?.params ?? null,
      storagePath: baseGeneration?.storagePath ?? null,
      url: input.baseImageUrl,
    })
  }

  if (input.coverUrl) {
    const coverGeneration = input.generationMemory?.coverRender as JsonObject | undefined
    assets.push({
      kind: 'cover_image',
      provider: coverGeneration?.provider ?? 'renderer',
      model: coverGeneration?.model ?? 'trend-cover',
      prompt: coverGeneration?.promptFinal ?? input.imagePrompt,
      promptOriginal: coverGeneration?.promptOriginal ?? input.imagePrompt,
      negativePrompt: coverGeneration?.negativePrompt ?? null,
      seed: coverGeneration?.seed ?? null,
      params: coverGeneration?.params ?? null,
      title: input.coverTitle,
      url: input.coverUrl,
    })
  }

  for (const shot of input.shotResults ?? []) {
    if (!shot.clipUrl) continue
    const videoAttempt = getLastAttempt(shot.videoGeneration)
    assets.push({
      kind: 'shot_video',
      shotId: shot.shotId ?? null,
      label: shot.label ?? null,
      provider: videoAttempt?.provider ?? input.videoProvider ?? 'higgsfield',
      model: videoAttempt?.model ?? input.providerModel ?? input.videoProvider ?? 'higgsfield',
      prompt: videoAttempt?.promptFinal ?? shot.motionPrompt ?? input.motionPrompt,
      promptOriginal: videoAttempt?.promptOriginal ?? shot.motionPrompt ?? input.motionPrompt,
      negativePrompt: videoAttempt?.negativePrompt ?? null,
      seed: videoAttempt?.seed ?? null,
      params: videoAttempt?.params ?? null,
      durationSec: shot.durationSec ?? null,
      providerJobId: shot.providerJobId ?? null,
      mode: videoAttempt?.mode ?? null,
      url: shot.clipUrl,
    })
  }

  if (input.videoUrl) {
    const finalVideoGeneration = input.generationMemory?.finalVideo as JsonObject | undefined
    assets.push({
      kind: 'final_video',
      provider: finalVideoGeneration?.provider ?? 'ffmpeg',
      model: finalVideoGeneration?.model ?? 'stitch-trend-video-clips',
      params: finalVideoGeneration?.params ?? null,
      url: input.videoUrl,
    })
  }

  return assets
}

export function buildTrendGiveawayPackage(input: BuildTrendGiveawayInput): JsonObject {
  const keyword = extractGiveawayKeyword(input.ctaText)
  const assets = buildAssetManifest(input)
  const shotRecipes = (input.shotResults ?? []).map((shot) => ({
    shotId: shot.shotId ?? null,
    label: shot.label ?? null,
    styleRole: shot.styleRole ?? null,
    visualStyle: shot.visualStyle ?? null,
    styleDirection: shot.styleDirection ?? null,
    visualIntent: shot.visualIntent ?? null,
    subjectAction: shot.subjectAction ?? null,
    environmentAction: shot.environmentAction ?? null,
    cameraMove: shot.cameraMove ?? null,
    lens: shot.lens ?? null,
    framing: shot.framing ?? null,
    lightShift: shot.lightShift ?? null,
    transition: shot.transition ?? null,
    payoff: shot.payoff ?? null,
    rhythm: shot.rhythm ?? null,
    motionPrompt: shot.motionPrompt ?? null,
    durationSec: shot.durationSec ?? null,
    clipUrl: shot.clipUrl ?? null,
    videoGeneration: shot.videoGeneration ?? null,
  }))

  const dmDeliveryText = [
    `Aqui vai o giveaway do video "${input.coverTitle}".`,
    `Keyword: ${keyword}`,
    `Estilo: ${input.style}`,
    `Modelo de video: ${input.providerModel ?? input.videoProvider ?? 'higgsfield'}`,
    `Prompt da capa: ${clipText(input.imagePrompt, 450)}`,
    `Prompt do video: ${clipText(input.motionPrompt, 450)}`,
    'Shots:',
    ...shotRecipes.map((shot, index) => {
      const shotPrompt = String(shot.motionPrompt ?? '').trim()
      return `${index + 1}. ${shot.label ?? `Shot ${index + 1}`}: ${clipText(shotPrompt, 220)}`
    }),
  ].join('\n')

  return {
    version: 'trend_giveaway_v1',
    keyword,
    headline: input.hookTitle,
    coverTitle: input.coverTitle,
    style: input.style,
    angle: input.angle,
    jobId: input.jobId,
    trendTopicId: input.trendTopicId ?? null,
    summary: {
      caption: input.caption,
      ctaText: input.ctaText,
      imageProvider: input.imageProvider ?? 'openai',
      videoProvider: input.videoProvider ?? 'higgsfield',
      providerModel: input.providerModel ?? null,
    },
    prompts: {
      cover: input.imagePrompt,
      masterMotion: input.motionPrompt,
      shots: shotRecipes,
    },
    generationMemory: input.generationMemory ?? null,
    assets,
    delivery: {
      channel: 'instagram_dm',
      requiresKeyword: true,
      requiresFollow: true,
      dmText: dmDeliveryText,
      commentReply: `Me segue e manda "${keyword}" na DM que eu te envio a receita completa.`,
    },
  }
}

export function parseGeneratedContentJson(raw: string): JsonObject | null {
  try {
    const parsed = JSON.parse(raw) as JsonObject
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
