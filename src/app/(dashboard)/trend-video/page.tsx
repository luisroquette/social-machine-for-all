import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  getTrendVideoOperationalStage,
} from '@/lib/trends/trend-video-ops-summary'
import { buildTrendVideoOpsSnapshot } from '@/lib/trends/trend-video-ops-snapshot'

type JobStatus = 'creative_ready' | 'image_ready' | 'cover_ready' | 'rendering' | 'ready' | 'published' | 'failed'
type JsonObject = Record<string, unknown>

interface TrendVideoJobRow {
  id: string
  trend_topic_id: string | null
  status: JobStatus
  style: string
  angle: string
  hook_title: string
  cover_title: string
  provider_model: string | null
  base_image_url: string | null
  cover_url: string | null
  video_url: string | null
  error_code: string | null
  error_message: string | null
  shot_results: unknown
  generation_memory: JsonObject | null
  published_generated_content_id: string | null
  created_at: string
  updated_at: string
}

interface GeneratedContentLiteRow {
  id: string
  published_url: string | null
}

interface TopicRow {
  id: string
  topic: string
  category: string
  source: string
  trend_score: number
  safety_status: string
  raw_payload?: JsonObject | null
}

interface StyleStatRow {
  style: string
  hook_pattern: string
  topic_category: string
  posts_count: number
  avg_reach: number | null
  avg_likes?: number | null
  avg_saves?: number | null
  avg_shares: number | null
  avg_prompt_requests?: number | null
  delivery_rate?: number | null
}

function relativeTime(date: string | null): string {
  if (!date) return 'never'
  const diff = Date.now() - new Date(date).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function statusBadge(status: string) {
  const variant =
    status === 'published' || status === 'ready' ? 'default' :
    status === 'failed' ? 'destructive' :
    status === 'rendering' ? 'secondary' :
    'outline'

  return <Badge variant={variant}>{status}</Badge>
}

function countByStatus(jobs: TrendVideoJobRow[], status: JobStatus): number {
  return jobs.filter((job) => job.status === status).length
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value) || 0
  return 0
}

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function getShotProgress(job: TrendVideoJobRow): { ready: number; total: number; failed: number } {
  const shots = Array.isArray(job.shot_results) ? job.shot_results as Array<Record<string, unknown>> : []
  if (!shots.length) return { ready: 0, total: 0, failed: 0 }

  return {
    ready: shots.filter((shot) => shot.status === 'ready').length,
    failed: shots.filter((shot) => shot.status === 'failed').length,
    total: shots.length,
  }
}

function getEditorialTemplate(job: TrendVideoJobRow): string {
  const planning = asJsonObject(job.generation_memory?.planning)
  const editorialTemplate = asJsonObject(planning?.editorialTemplate)
  return typeof editorialTemplate?.label === 'string' ? editorialTemplate.label : '-'
}

function getImageProviderSummary(job: TrendVideoJobRow): string {
  const coverBaseImage = asJsonObject(job.generation_memory?.coverBaseImage)
  const provider = typeof coverBaseImage?.provider === 'string' ? coverBaseImage.provider : null
  const model = typeof coverBaseImage?.model === 'string' ? coverBaseImage.model : null
  return provider ? [provider, model].filter(Boolean).join(' / ') : '-'
}

function getAnalytics(job: TrendVideoJobRow): { reach: number; likes: number; comments: number; promptRequests: number; deliveryRate: number } {
  const analytics = asJsonObject(job.generation_memory?.analytics)
  const instagram = asJsonObject(analytics?.instagram)
  const engagement = asJsonObject(instagram?.engagement)
  const funnel = asJsonObject(engagement?.giveaway_funnel)

  return {
    reach: toNumber(engagement?.reach),
    likes: toNumber(engagement?.likes),
    comments: toNumber(engagement?.comments),
    promptRequests: toNumber(funnel?.promptRequests),
    deliveryRate: toNumber(funnel?.deliveryRate),
  }
}

function getTopicScores(topic: TopicRow | undefined): { base: number; learned: number } {
  const rawPayload = asJsonObject(topic?.raw_payload)
  const base = toNumber(rawPayload?.base_trend_score ?? topic?.trend_score)
  const learned = toNumber(rawPayload?.adaptive_trend_score ?? topic?.trend_score)
  return { base, learned }
}

export default async function TrendVideoDashboardPage() {
  const supabase = getAdminClient()
  const workspaceId = await getActiveWorkspaceId()

  const [
    { data: jobsRaw },
    { data: styleStatsRaw },
    { count: animateEligibleRaw },
    { count: publishEligibleRaw },
    { count: metricsEligibleRaw },
  ] = await Promise.all([
    supabase
      .from('trend_video_jobs')
      .select('id, trend_topic_id, status, style, angle, hook_title, cover_title, provider_model, base_image_url, cover_url, video_url, error_code, error_message, shot_results, generation_memory, published_generated_content_id, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('trend_style_stats')
      .select('style, hook_pattern, topic_category, posts_count, avg_reach, avg_likes, avg_saves, avg_shares, avg_prompt_requests, delivery_rate')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase
      .from('trend_video_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('status', ['creative_ready', 'image_ready', 'cover_ready', 'rendering']),
    supabase
      .from('trend_video_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'ready'),
    supabase
      .from('trend_video_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'published')
      .not('published_generated_content_id', 'is', null),
  ])

  const jobs = (jobsRaw ?? []) as TrendVideoJobRow[]
  const animateEligible = animateEligibleRaw ?? 0
  const publishEligible = publishEligibleRaw ?? 0
  const metricsEligible = metricsEligibleRaw ?? 0
  const opsSnapshot = buildTrendVideoOpsSnapshot(jobs)
  const currentBottleneck = opsSnapshot.bottleneck
  const bottleneckJobs = opsSnapshot.bottleneckJobs as TrendVideoJobRow[]
  const bottleneckJobGroups = opsSnapshot.groups.map((group) => ({
    stage: group.stage,
    summary: group.summary,
    jobs: group.jobs as TrendVideoJobRow[],
  }))
  const generatedContentIds = jobs
    .map((job) => job.published_generated_content_id)
    .filter((id): id is string => Boolean(id))
  const bottleneckBadgeVariant = currentBottleneck.severity === 'high'
    ? 'destructive'
    : currentBottleneck.severity === 'medium'
      ? 'secondary'
      : 'outline'
  const topicIds = jobs.map((job) => job.trend_topic_id).filter((id): id is string => Boolean(id))
  const { data: topicsRaw } = topicIds.length
    ? await supabase
        .from('br_trend_topics')
        .select('id, topic, category, source, trend_score, safety_status, raw_payload')
        .in('id', topicIds)
    : { data: [] }
  const { data: generatedContentsRaw } = generatedContentIds.length
    ? await supabase
        .from('generated_content')
        .select('id, published_url')
        .in('id', generatedContentIds)
    : { data: [] }

  const topicsById = new Map((topicsRaw ?? []).map((topic) => [(topic as TopicRow).id, topic as TopicRow]))
  const generatedContentById = new Map((generatedContentsRaw ?? []).map((item) => [(item as GeneratedContentLiteRow).id, item as GeneratedContentLiteRow]))
  const publishedJobs = jobs.filter((job) => job.status === 'published')
  const analyticsTotals = publishedJobs.reduce((totals, job) => {
    const analytics = getAnalytics(job)
    totals.reach += analytics.reach
    totals.promptRequests += analytics.promptRequests
    return totals
  }, { reach: 0, promptRequests: 0 })
  const opsConfig = opsSnapshot.config

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trend Video</h2>
        <p className="text-sm text-muted-foreground">Fila operacional do pipeline tema, capa, shots, video, carrossel e giveaway.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Em Produção</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{countByStatus(jobs, 'creative_ready') + countByStatus(jobs, 'image_ready') + countByStatus(jobs, 'cover_ready') + countByStatus(jobs, 'rendering')}</div>
            <p className="text-xs text-muted-foreground">creative/image/cover/rendering</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Prontos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{countByStatus(jobs, 'ready')}</div>
            <p className="text-xs text-muted-foreground">aguardando publish</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Publicados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{publishedJobs.length}</div>
            <p className="text-xs text-muted-foreground">alcance total {analyticsTotals.reach}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Falhas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{countByStatus(jobs, 'failed')}</div>
            <p className="text-xs text-muted-foreground">{analyticsTotals.promptRequests} pedidos PROMPT</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Animate Eligible</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{animateEligible}</div>
            <p className="text-xs text-muted-foreground">creative/image/cover/rendering</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Publish Eligible</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{publishEligible}</div>
            <p className="text-xs text-muted-foreground">jobs ready para carrossel</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Metrics Eligible</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metricsEligible}</div>
            <p className="text-xs text-muted-foreground">publicados com content id</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Regras Ativas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>animate: {opsConfig.animateStatuses.join(', ')}</span>
          <span>top jobs: {opsConfig.bottleneckMaxJobs}</span>
          <span>metricas: {opsConfig.metricsWindowDays}d</span>
          <span>severidade: medium {opsConfig.severityThresholds.medium}+ / high {opsConfig.severityThresholds.high}+</span>
          <span>quality: score {opsConfig.quality.staticGate.passScore}+ / max issues {opsConfig.quality.staticGate.maxIssues}</span>
          <span>video: {opsConfig.quality.staticGate.minTotalDurationSec}s / {opsConfig.quality.staticGate.minShots}+ shots</span>
          <span>visual QA: motion {opsConfig.quality.visualQa.minMotionScore}+ / frames {opsConfig.quality.visualQa.minSampledFrames}+</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Gargalo Atual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <div className="text-2xl font-bold">{currentBottleneck.label}</div>
            <Badge variant={bottleneckBadgeVariant}>{currentBottleneck.count}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{currentBottleneck.detail}</p>
          <p className="mt-2 text-sm">Acao sugerida: {currentBottleneck.action}</p>
          {bottleneckJobs.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Jobs impactados</p>
              {bottleneckJobGroups.map((group) => (
                <div
                  key={group.stage}
                  className={group.stage === bottleneckJobGroups[0]?.stage
                    ? 'space-y-2 rounded-lg border border-orange-300 bg-orange-50/60 p-3'
                    : 'space-y-2'}
                >
                  {(() => {
                    const summary = group.summary
                    return (
                      <>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{group.stage}</Badge>
                    <span className="text-xs text-muted-foreground">{group.jobs.length} item(ns)</span>
                  </div>
                  {group.stage === bottleneckJobGroups[0]?.stage && (
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{summary.total} jobs</span>
                      <span>{summary.withError} com erro</span>
                      <span>{summary.withReadyAsset} com asset pronto</span>
                      <span>{summary.publishableNow} publicavel agora</span>
                    </div>
                  )}
                  {group.jobs.map((job) => {
                    const published = job.published_generated_content_id
                      ? generatedContentById.get(job.published_generated_content_id)
                      : null
                    const stage = getTrendVideoOperationalStage(job)

                    return (
                      <div key={job.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium">{job.cover_title}</p>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{stage}</Badge>
                            {statusBadge(job.status)}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {job.provider_model ?? '-'} · atualizado {relativeTime(job.updated_at)}
                        </p>
                        {job.error_code && <p className="mt-1 text-xs text-destructive">{job.error_code}</p>}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs">
                          {published?.published_url && <Link className="underline" href={published.published_url}>post</Link>}
                          {job.video_url && <Link className="underline" href={job.video_url}>video</Link>}
                          {job.cover_url && <Link className="underline" href={job.cover_url}>cover</Link>}
                          {job.base_image_url && <Link className="underline" href={job.base_image_url}>base</Link>}
                          <span className="text-muted-foreground">job {job.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    )
                  })}
                      </>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jobs Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Tema</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Shots</TableHead>
                <TableHead>Imagem</TableHead>
                <TableHead>Video</TableHead>
                <TableHead>Analytics</TableHead>
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length > 0 ? jobs.map((job) => {
                const topic = topicsById.get(job.trend_topic_id ?? '')
                const progress = getShotProgress(job)
                const analytics = getAnalytics(job)
                const scores = getTopicScores(topic)
                return (
                  <TableRow key={job.id}>
                    <TableCell>{statusBadge(job.status)}</TableCell>
                    <TableCell>
                      <div className="max-w-[260px]">
                        <p className="truncate font-medium">{topic?.topic ?? job.cover_title}</p>
                        <p className="text-xs text-muted-foreground">{topic?.category ?? '-'} · score {scores.base} -&gt; {scores.learned}</p>
                        {job.error_code && <p className="mt-1 text-xs text-destructive">{job.error_code}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{getEditorialTemplate(job)}</p>
                      <p className="text-xs text-muted-foreground">{job.style}</p>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{progress.ready}/{progress.total}</span>
                      {progress.failed > 0 && <span className="ml-1 text-xs text-destructive">({progress.failed} falhou)</span>}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-muted-foreground">{getImageProviderSummary(job)}</p>
                      <div className="mt-1 flex gap-2 text-xs">
                        {job.cover_url && <Link className="underline" href={job.cover_url}>capa</Link>}
                        {job.base_image_url && <Link className="underline" href={job.base_image_url}>base</Link>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-muted-foreground">{job.provider_model ?? '-'}</p>
                      {job.video_url && <Link className="text-xs underline" href={job.video_url}>video</Link>}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs">reach {analytics.reach}</p>
                      <p className="text-xs text-muted-foreground">PROMPT {analytics.promptRequests} · entrega {analytics.deliveryRate}%</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(job.updated_at)}</TableCell>
                  </TableRow>
                )
              }) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-sm text-muted-foreground">Nenhum job trend video encontrado.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aprendizado por Estilo</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estilo</TableHead>
                <TableHead>Hook</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Posts</TableHead>
                <TableHead>Reach</TableHead>
                <TableHead>Saves/Shares</TableHead>
                <TableHead>Giveaway</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {((styleStatsRaw ?? []) as StyleStatRow[]).map((stat) => (
                <TableRow key={`${stat.style}-${stat.hook_pattern}-${stat.topic_category}`}>
                  <TableCell>{stat.style}</TableCell>
                  <TableCell>{stat.hook_pattern}</TableCell>
                  <TableCell>{stat.topic_category}</TableCell>
                  <TableCell>{stat.posts_count}</TableCell>
                  <TableCell>{Math.round(Number(stat.avg_reach ?? 0))}</TableCell>
                  <TableCell>{Math.round(Number(stat.avg_saves ?? 0))}/{Math.round(Number(stat.avg_shares ?? 0))}</TableCell>
                  <TableCell>{Number(stat.avg_prompt_requests ?? 0).toFixed(1)} pedidos · {Number(stat.delivery_rate ?? 0).toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
