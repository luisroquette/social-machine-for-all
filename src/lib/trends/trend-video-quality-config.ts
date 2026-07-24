export const TREND_VIDEO_QUALITY_PASS_SCORE = 7
export const TREND_VIDEO_QUALITY_MAX_ISSUES = 2
export const TREND_VIDEO_QUALITY_MIN_CAPTION_CHARS = 90
export const TREND_VIDEO_QUALITY_MIN_TOTAL_DURATION_SEC = 10
export const TREND_VIDEO_QUALITY_MIN_SHOTS = 4
export const TREND_VIDEO_QUALITY_MIN_UNIQUE_STYLE_TARGET = 3
export const TREND_VIDEO_QUALITY_MIN_UNIQUE_INTENT_TARGET = 3

export const TREND_VIDEO_VISUAL_QA_MIN_SAMPLED_FRAMES = 4
export const TREND_VIDEO_VISUAL_QA_MIN_AVG_FRAME_DELTA = 2.5
export const TREND_VIDEO_VISUAL_QA_MIN_MAX_FRAME_DELTA = 5
export const TREND_VIDEO_VISUAL_QA_MIN_MOTION_SCORE = 2.2
export const TREND_VIDEO_VISUAL_QA_DUPLICATE_RATIO = 0.6
export const TREND_VIDEO_VISUAL_QA_FAIL_ON_UNAVAILABLE = true

export interface TrendVideoQualityObservabilityConfig {
  staticGate: {
    passScore: number
    maxIssues: number
    minCaptionChars: number
    minTotalDurationSec: number
    minShots: number
    minUniqueStyleTarget: number
    minUniqueIntentTarget: number
  }
  visualQa: {
    minSampledFrames: number
    minAvgFrameDelta: number
    minMaxFrameDelta: number
    minMotionScore: number
    duplicateRatio: number
    failOnUnavailable: boolean
  }
}

export function getTrendVideoQualityObservabilityConfig(): TrendVideoQualityObservabilityConfig {
  return {
    staticGate: {
      passScore: TREND_VIDEO_QUALITY_PASS_SCORE,
      maxIssues: TREND_VIDEO_QUALITY_MAX_ISSUES,
      minCaptionChars: TREND_VIDEO_QUALITY_MIN_CAPTION_CHARS,
      minTotalDurationSec: TREND_VIDEO_QUALITY_MIN_TOTAL_DURATION_SEC,
      minShots: TREND_VIDEO_QUALITY_MIN_SHOTS,
      minUniqueStyleTarget: TREND_VIDEO_QUALITY_MIN_UNIQUE_STYLE_TARGET,
      minUniqueIntentTarget: TREND_VIDEO_QUALITY_MIN_UNIQUE_INTENT_TARGET,
    },
    visualQa: {
      minSampledFrames: TREND_VIDEO_VISUAL_QA_MIN_SAMPLED_FRAMES,
      minAvgFrameDelta: TREND_VIDEO_VISUAL_QA_MIN_AVG_FRAME_DELTA,
      minMaxFrameDelta: TREND_VIDEO_VISUAL_QA_MIN_MAX_FRAME_DELTA,
      minMotionScore: TREND_VIDEO_VISUAL_QA_MIN_MOTION_SCORE,
      duplicateRatio: TREND_VIDEO_VISUAL_QA_DUPLICATE_RATIO,
      failOnUnavailable: TREND_VIDEO_VISUAL_QA_FAIL_ON_UNAVAILABLE,
    },
  }
}
