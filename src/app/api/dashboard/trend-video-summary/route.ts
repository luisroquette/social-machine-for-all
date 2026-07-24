import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  getTrendVideoOperationalStage,
  type TrendVideoOpsJobLike,
} from '@/lib/trends/trend-video-ops-summary'
import { buildTrendVideoOpsSnapshot } from '@/lib/trends/trend-video-ops-snapshot'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const supabase = getAdminClient()
  const { data: jobsRaw } = await supabase
    .from('trend_video_jobs')
    .select('id, status, cover_title, provider_model, base_image_url, cover_url, video_url, error_code, published_generated_content_id, updated_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(30)

  const jobs = (jobsRaw ?? []) as TrendVideoOpsJobLike[]
  const snapshot = buildTrendVideoOpsSnapshot(jobs)

  return NextResponse.json({
    config: snapshot.config,
    summary: snapshot.summary,
    bottleneck: snapshot.bottleneck,
    groups: snapshot.groups.map((group) => ({
      stage: group.stage,
      summary: group.summary,
      jobs: group.jobs.map((job) => ({
        id: job.id,
        status: job.status,
        operationalStage: getTrendVideoOperationalStage(job),
        coverTitle: job.cover_title,
        providerModel: job.provider_model,
        errorCode: job.error_code,
        videoUrl: job.video_url,
        coverUrl: job.cover_url,
        baseImageUrl: job.base_image_url,
        publishedGeneratedContentId: job.published_generated_content_id,
        updatedAt: job.updated_at,
      })),
    })),
  })
}
