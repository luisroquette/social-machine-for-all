import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'
import {
  TREND_VIDEO_VISUAL_QA_DUPLICATE_RATIO,
  TREND_VIDEO_VISUAL_QA_FAIL_ON_UNAVAILABLE,
  TREND_VIDEO_VISUAL_QA_MIN_AVG_FRAME_DELTA,
  TREND_VIDEO_VISUAL_QA_MIN_MAX_FRAME_DELTA,
  TREND_VIDEO_VISUAL_QA_MIN_MOTION_SCORE,
  TREND_VIDEO_VISUAL_QA_MIN_SAMPLED_FRAMES,
} from '@/lib/trends/trend-video-quality-config'

const execFileAsync = promisify(execFile)
const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const CHANNELS = 3
const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT * CHANNELS

export interface TrendVideoVisualQaMetrics {
  sampledFrames: number
  avgFrameDelta: number
  maxFrameDelta: number
  duplicateFramePairs: number
  motionScore: number
}

export interface TrendVideoVisualQaResult {
  passed: boolean
  issues: string[]
  criticalIssues: string[]
  metrics: TrendVideoVisualQaMetrics
  error?: string
}

function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'
}

function averageFrameDelta(a: Buffer, b: Buffer): number {
  const length = Math.min(a.length, b.length)
  if (!length) return 0

  let sum = 0
  for (let i = 0; i < length; i++) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum / length
}

export function scoreVisualFrameDeltas(frames: Buffer[]): TrendVideoVisualQaResult {
  const issues: string[] = []
  const criticalIssues: string[] = []

  if (frames.length < TREND_VIDEO_VISUAL_QA_MIN_SAMPLED_FRAMES) {
    issues.push(`not_enough_sampled_frames:${frames.length}`)
  }

  const deltas: number[] = []
  for (let i = 1; i < frames.length; i++) {
    deltas.push(averageFrameDelta(frames[i - 1], frames[i]))
  }

  const avgFrameDelta = deltas.length
    ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    : 0
  const maxFrameDelta = deltas.length ? Math.max(...deltas) : 0
  const duplicateFramePairs = deltas.filter((value) => value < 1.2).length
  const motionScore = Math.max(0, Math.min(10, (avgFrameDelta / 8) * 7 + (maxFrameDelta / 18) * 3))

  if (
    frames.length >= TREND_VIDEO_VISUAL_QA_MIN_SAMPLED_FRAMES &&
    avgFrameDelta < TREND_VIDEO_VISUAL_QA_MIN_AVG_FRAME_DELTA &&
    maxFrameDelta < TREND_VIDEO_VISUAL_QA_MIN_MAX_FRAME_DELTA
  ) {
    criticalIssues.push(`visual_photo_loop_risk:${avgFrameDelta.toFixed(2)}/${maxFrameDelta.toFixed(2)}`)
  }

  if (motionScore < TREND_VIDEO_VISUAL_QA_MIN_MOTION_SCORE) {
    criticalIssues.push(`motion_score_too_low:${motionScore.toFixed(2)}`)
  }

  if (duplicateFramePairs >= Math.max(2, Math.floor(deltas.length * TREND_VIDEO_VISUAL_QA_DUPLICATE_RATIO))) {
    issues.push(`too_many_near_duplicate_frames:${duplicateFramePairs}`)
  }

  return {
    passed: criticalIssues.length === 0,
    issues,
    criticalIssues,
    metrics: {
      sampledFrames: frames.length,
      avgFrameDelta: Number(avgFrameDelta.toFixed(2)),
      maxFrameDelta: Number(maxFrameDelta.toFixed(2)),
      duplicateFramePairs,
      motionScore: Number(motionScore.toFixed(2)),
    },
  }
}

function splitRawFrames(stdout: Buffer): Buffer[] {
  const frames: Buffer[] = []
  for (let offset = 0; offset + FRAME_SIZE <= stdout.length; offset += FRAME_SIZE) {
    frames.push(stdout.subarray(offset, offset + FRAME_SIZE))
  }
  return frames
}

export async function analyzeTrendVideoVisualQuality(videoUrl: string): Promise<TrendVideoVisualQaResult> {
  try {
    const { stdout } = await execFileAsync(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoUrl,
      '-vf',
      `fps=1,scale=${FRAME_WIDTH}:${FRAME_HEIGHT},format=rgb24`,
      '-frames:v',
      '8',
      '-f',
      'rawvideo',
      'pipe:1',
    ], {
      encoding: 'buffer',
      timeout: 45_000,
      maxBuffer: FRAME_SIZE * 12,
    }) as unknown as { stdout: Buffer }

    return scoreVisualFrameDeltas(splitRawFrames(stdout))
  } catch (error) {
    return {
      passed: !TREND_VIDEO_VISUAL_QA_FAIL_ON_UNAVAILABLE,
      issues: TREND_VIDEO_VISUAL_QA_FAIL_ON_UNAVAILABLE ? [] : ['visual_qa_unavailable'],
      criticalIssues: TREND_VIDEO_VISUAL_QA_FAIL_ON_UNAVAILABLE ? ['visual_qa_unavailable'] : [],
      metrics: {
        sampledFrames: 0,
        avgFrameDelta: 0,
        maxFrameDelta: 0,
        duplicateFramePairs: 0,
        motionScore: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
