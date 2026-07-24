export interface RecoverableSegment {
  clipUrl: string | null
  durationSec: number
}

interface RawSegment {
  clipUrl?: unknown
  durationSec?: unknown
}

interface RawShot {
  segments?: unknown
}

function toSegment(raw: RawSegment): RecoverableSegment {
  return {
    clipUrl: typeof raw.clipUrl === 'string' ? raw.clipUrl : null,
    durationSec: typeof raw.durationSec === 'number' ? raw.durationSec : Number(raw.durationSec) || 1.5,
  }
}

export function recoverTrendVideoSegments(shotResults: unknown): {
  segments: RecoverableSegment[]
  recoveredMissingSegments: number
  recoverable: boolean
} {
  if (!Array.isArray(shotResults)) {
    return { segments: [], recoveredMissingSegments: 0, recoverable: false }
  }

  const shots = shotResults
    .filter((shot): shot is RawShot => Boolean(shot) && typeof shot === 'object')
    .map((shot) => Array.isArray(shot.segments) ? shot.segments.filter((segment): segment is RawSegment => Boolean(segment) && typeof segment === 'object').map(toSegment) : [])
    .filter((segments) => segments.length > 0)

  const missingCount = shots.flat().filter((segment) => !segment.clipUrl).length
  if (missingCount === 0) {
    return { segments: shots.flat(), recoveredMissingSegments: 0, recoverable: true }
  }

  if (missingCount > 1) {
    return { segments: shots.flat(), recoveredMissingSegments: 0, recoverable: false }
  }

  const recoveredShots = shots.map((segments, shotIndex) =>
    segments.map((segment, segmentIndex) => {
      if (segment.clipUrl) return segment

      const sibling = segments.find((candidate, candidateIndex) => candidateIndex !== segmentIndex && candidate.clipUrl)?.clipUrl
      const previous = shots
        .slice(0, shotIndex + 1)
        .flat()
        .reverse()
        .find((candidate) => candidate.clipUrl)?.clipUrl
      const next = shots
        .slice(shotIndex)
        .flat()
        .find((candidate) => candidate.clipUrl)?.clipUrl
      const fallbackClipUrl = sibling || previous || next || null

      return {
        ...segment,
        clipUrl: fallbackClipUrl,
      }
    }),
  )

  const recoverable = recoveredShots.flat().every((segment) => Boolean(segment.clipUrl))
  return {
    segments: recoveredShots.flat(),
    recoveredMissingSegments: recoverable ? 1 : 0,
    recoverable,
  }
}
