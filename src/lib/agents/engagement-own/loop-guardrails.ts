interface GuardrailHistoryAction {
  createdAt: string | null
  executedAt: string | null
  status: string | null
  commentText: string | null
  metadata: Record<string, unknown> | null
}

interface GuardrailReplyEvent {
  id: string
  author: string
  text: string
  createdAt: string
  threadId?: string | null
}

interface ThreadMemoryInput {
  ownHandle: string
  replyAuthor: string
  currentReplyId: string
  threadId?: string | null
  recentPairActions: GuardrailHistoryAction[]
  recentReplies: GuardrailReplyEvent[]
}

interface NoveltyInput {
  candidateReply: string
  originalReplyText: string
  recentOwnReplies: string[]
}

export interface ThreadMemory {
  pairId: string
  threadId: string
  threadKey: string
  recentPairTurns: number
  recentOwnReplies: number
  recentThirdPartyReplies: number
  turnAlternationStreak: number
  pairDominance: number
  thirdPartyAbsent: boolean
  rapidBackAndForth: boolean
  trailingLowNoveltyStreak: number
}

export interface NoveltyAssessment {
  score: number
  strong: boolean
  useful: boolean
  reasons: string[]
}

export type GuardrailAction = 'allow' | 'allow_if_strong_novelty' | 'cooldown' | 'block'

export interface GuardrailDecision {
  action: GuardrailAction
  loopScore: number
  reasons: string[]
  sameOwner: boolean
  knownAgent: boolean
}

const GENERIC_REPLY_PATTERNS = [
  /\bobrigad[oa]\b/i,
  /\bvaleu\b/i,
  /\botim[oa] ponto\b/i,
  /\bboa\b/i,
  /\bshow\b/i,
  /\btop\b/i,
  /\bperfeito\b/i,
]

const UTILITY_SIGNAL_PATTERN = /\b(test|teste|bench|benchmark|latenc|dataset|paper|link|query|queries|recall|precision|p95|p99|token|custo|trade-?off|mem[oó]ria|hnsw|ivf|rerank|embedding|prompt|agent|chain|vector|sql|cache|index|infra)\b/i

function normalizeHandle(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^@+/, '').toLowerCase()
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3)
}

function toSet(tokens: string[]): Set<string> {
  return new Set(tokens)
}

function jaccardSimilarity(a: string, b: string): number {
  const left = toSet(tokenize(a))
  const right = toSet(tokenize(b))
  if (left.size === 0 || right.size === 0) return 0

  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection++
  }

  return intersection / (left.size + right.size - intersection)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

function extractGuardrailFlag(metadata: Record<string, unknown> | null, key: string): boolean | null {
  const guardrail = metadata?.guardrail
  if (!guardrail || typeof guardrail !== 'object') return null
  const value = (guardrail as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? value : null
}

export function parseHandleList(...sources: Array<string | null | undefined>): Set<string> {
  const handles = new Set<string>()

  for (const source of sources) {
    if (!source) continue
    for (const part of source.split(/[,\n]/)) {
      const normalized = normalizeHandle(part)
      if (normalized) handles.add(normalized)
    }
  }

  return handles
}

export function resolveThreadId(params: {
  conversationId?: string | null
  rootTweetId?: string | null
  currentReplyId: string
}): string {
  return params.conversationId ?? params.rootTweetId ?? params.currentReplyId
}

export function buildThreadMemory(input: ThreadMemoryInput): ThreadMemory {
  const ownHandle = normalizeHandle(input.ownHandle)
  const replyAuthor = normalizeHandle(input.replyAuthor)
  const pairId = [ownHandle, replyAuthor].sort().join(':')
  const threadId = resolveThreadId({
    conversationId: input.threadId,
    currentReplyId: input.currentReplyId,
  })
  const threadKey = `${threadId}:${pairId}`

  const otherAuthors = new Set(
    input.recentReplies
      .filter(reply => resolveThreadId({
        conversationId: reply.threadId,
        currentReplyId: reply.id,
      }) === threadId)
      .map(reply => normalizeHandle(reply.author))
      .filter(author => author && author !== replyAuthor)
  )

  const thirdPartyReplies = input.recentReplies
    .filter(reply => (
      normalizeHandle(reply.author) === replyAuthor &&
      resolveThreadId({
        conversationId: reply.threadId,
        currentReplyId: reply.id,
      }) === threadId
    ))
    .sort((a, b) => (parseTimestamp(a.createdAt) ?? 0) - (parseTimestamp(b.createdAt) ?? 0))
  const threadReplyCount = input.recentReplies.filter(reply => (
    resolveThreadId({
      conversationId: reply.threadId,
      currentReplyId: reply.id,
    }) === threadId
  )).length

  const ownReplies = input.recentPairActions
    .filter(action => action.status !== 'failed')
    .sort((a, b) => (parseTimestamp(a.executedAt ?? a.createdAt) ?? 0) - (parseTimestamp(b.executedAt ?? b.createdAt) ?? 0))

  const mergedEvents = [
    ...thirdPartyReplies.map(reply => ({
      actor: 'them' as const,
      ts: parseTimestamp(reply.createdAt) ?? 0,
    })),
    ...ownReplies.map(action => ({
      actor: 'us' as const,
      ts: parseTimestamp(action.executedAt ?? action.createdAt) ?? 0,
    })),
  ]
    .sort((a, b) => a.ts - b.ts)
    .slice(-8)

  let alternationStreak = mergedEvents.length > 0 ? 1 : 0
  for (let i = mergedEvents.length - 1; i > 0; i--) {
    if (mergedEvents[i].actor === mergedEvents[i - 1].actor) break
    alternationStreak++
  }

  const lastThirdPartyTs = parseTimestamp(thirdPartyReplies.at(-1)?.createdAt ?? null)
  const lastOwnTs = parseTimestamp(ownReplies.at(-1)?.executedAt ?? ownReplies.at(-1)?.createdAt ?? null)
  const rapidBackAndForth =
    lastThirdPartyTs !== null &&
    lastOwnTs !== null &&
    Math.abs(lastThirdPartyTs - lastOwnTs) <= 90 * 60 * 1000

  let trailingLowNoveltyStreak = 0
  for (let i = ownReplies.length - 1; i >= 0; i--) {
    const lowNovelty = extractGuardrailFlag(ownReplies[i].metadata, 'hasNovelty')
    if (lowNovelty !== false) break
    trailingLowNoveltyStreak++
  }

  return {
    pairId,
    threadId,
    threadKey,
    recentPairTurns: mergedEvents.length,
    recentOwnReplies: ownReplies.length,
    recentThirdPartyReplies: thirdPartyReplies.length,
    turnAlternationStreak: alternationStreak,
    pairDominance: threadReplyCount > 0 ? thirdPartyReplies.length / threadReplyCount : 0,
    thirdPartyAbsent: otherAuthors.size === 0,
    rapidBackAndForth,
    trailingLowNoveltyStreak,
  }
}

export function assessNovelty(input: NoveltyInput): NoveltyAssessment {
  const candidate = input.candidateReply.trim()
  if (!candidate) {
    return { score: 0, strong: false, useful: false, reasons: ['empty_candidate'] }
  }

  const reasons: string[] = []
  let score = 0.2

  if (candidate.length >= 24) score += 0.1
  if (candidate.includes('?')) {
    score += 0.18
    reasons.push('has_question')
  }
  if (/\d|%/.test(candidate)) {
    score += 0.22
    reasons.push('has_metric')
  }
  if (/https?:\/\//i.test(candidate)) {
    score += 0.24
    reasons.push('has_link')
  }
  if (UTILITY_SIGNAL_PATTERN.test(candidate)) {
    score += 0.2
    reasons.push('has_technical_signal')
  }

  const overlapWithOriginal = jaccardSimilarity(candidate, input.originalReplyText)
  if (overlapWithOriginal > 0.72) {
    score -= 0.18
    reasons.push('high_overlap_with_source')
  }

  const maxSelfSimilarity = input.recentOwnReplies.reduce((max, previous) => {
    return Math.max(max, jaccardSimilarity(candidate, previous))
  }, 0)
  if (maxSelfSimilarity > 0.72) {
    score -= 0.3
    reasons.push('repeats_previous_reply')
  }

  if (GENERIC_REPLY_PATTERNS.some(pattern => pattern.test(candidate))) {
    score -= 0.22
    reasons.push('generic_phrase')
  }

  const useful = reasons.some(reason => (
    reason === 'has_question' ||
    reason === 'has_metric' ||
    reason === 'has_link' ||
    reason === 'has_technical_signal'
  ))

  score = clamp(score, 0, 1)
  return {
    score,
    useful,
    strong: useful && score >= 0.55,
    reasons,
  }
}

export function decideGuardrailAction(params: {
  memory: ThreadMemory
  novelty: NoveltyAssessment
  counterpartyHandle: string
  ownedHandles: Set<string>
  knownAgentHandles: Set<string>
}): GuardrailDecision {
  const counterparty = normalizeHandle(params.counterpartyHandle)
  const sameOwner = params.ownedHandles.has(counterparty)
  const knownAgent = params.knownAgentHandles.has(counterparty)
  const reasons: string[] = []
  let loopScore = 0

  if (sameOwner) {
    loopScore += 0.45
    reasons.push('same_owner')
  } else if (knownAgent) {
    loopScore += 0.22
    reasons.push('known_agent')
  }

  if (params.memory.turnAlternationStreak >= 4) {
    loopScore += 0.22
    reasons.push('alternation_streak_high')
  } else if (params.memory.turnAlternationStreak >= 2) {
    loopScore += 0.12
    reasons.push('alternation_streak_medium')
  }

  if (params.memory.pairDominance >= 0.66) {
    loopScore += 0.14
    reasons.push('pair_dominance_high')
  } else if (params.memory.pairDominance >= 0.5) {
    loopScore += 0.08
    reasons.push('pair_dominance_medium')
  }

  if (params.memory.thirdPartyAbsent) {
    loopScore += 0.1
    reasons.push('no_third_party')
  }

  if (params.memory.rapidBackAndForth) {
    loopScore += 0.08
    reasons.push('rapid_back_and_forth')
  }

  if (params.memory.trailingLowNoveltyStreak >= 2) {
    loopScore += 0.18
    reasons.push('prior_low_novelty_streak')
  } else if (params.memory.trailingLowNoveltyStreak === 1) {
    loopScore += 0.08
    reasons.push('prior_low_novelty')
  }

  if (!params.novelty.useful) {
    loopScore += 0.12
    reasons.push('current_low_utility')
  }

  if (sameOwner) {
    if (params.memory.turnAlternationStreak >= 2 && params.memory.thirdPartyAbsent) {
      reasons.push('same_owner_cross_talk')
    } else {
      reasons.push('same_owner_hard_block')
    }
    return {
      action: 'block',
      loopScore: clamp(loopScore + 0.25, 0, 1),
      reasons,
      sameOwner,
      knownAgent,
    }
  }

  loopScore = clamp(loopScore, 0, 1)

  if (loopScore >= 0.78) {
    return { action: 'cooldown', loopScore, reasons, sameOwner, knownAgent }
  }

  if (loopScore >= 0.52) {
    return { action: 'allow_if_strong_novelty', loopScore, reasons, sameOwner, knownAgent }
  }

  return { action: 'allow', loopScore, reasons, sameOwner, knownAgent }
}
