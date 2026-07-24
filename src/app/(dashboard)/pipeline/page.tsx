import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getAdminClient } from '@/lib/supabase/admin'
import { ContentQueue } from '@/components/pipeline/content-queue'


const PIPELINE_STAGE_DEFS = [
  { name: 'Monitor', icon: '🔍', desc: 'Trending topics' },
  { name: 'Curador', icon: '📋', desc: 'Content discovery' },
  { name: 'Redator', icon: '✍️', desc: 'Content creation' },
  { name: 'Revisor', icon: '🔎', desc: 'Quality review' },
  { name: 'Publicador', icon: '📤', desc: 'Publishing' },
]

function relativeTime(date: string | null): string {
  if (!date) return 'never'
  const diff = Date.now() - new Date(date).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '--'
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}

function statusBadge(status: string | null) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    completed: { label: 'completed', variant: 'default' },
    running: { label: 'running', variant: 'secondary' },
    failed: { label: 'failed', variant: 'destructive' },
    partial: { label: 'partial', variant: 'outline' },
  }
  const info = (status ? map[status] : undefined) ?? { label: status ?? 'unknown', variant: 'outline' as const }
  return <Badge variant={info.variant}>{info.label}</Badge>
}

function countByStatus(items: { status: string | null }[] | null, status: string): number {
  if (!items) return 0
  return items.filter(i => i.status === status).length
}

export default async function PipelinePage() {
  const supabase = getAdminClient()
  const WORKSPACE_ID = await getActiveWorkspaceId()

  const [
    { data: pipelineRuns },
    { data: trendingTopics },
    { data: generatedContent },
    { data: approvedQueue },
  ] = await Promise.all([
    supabase
      .from('pipeline_runs')
      .select('id, status, started_at, completed_at, stages_completed, trigger')
      .eq('workspace_id', WORKSPACE_ID)
      .order('started_at', { ascending: false })
      .limit(10),
    supabase
      .from('trending_topics')
      .select('status')
      .eq('workspace_id', WORKSPACE_ID),
    supabase
      .from('generated_content')
      .select('status')
      .eq('workspace_id', WORKSPACE_ID),
    supabase
      .from('generated_content')
      .select('id, target_platform, target_format, content, retry_count, created_at')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .limit(50),
  ])

  const stageVolumes = [
    countByStatus(trendingTopics, 'new') + countByStatus(trendingTopics, 'curating'),
    countByStatus(trendingTopics, 'curated'),
    countByStatus(generatedContent, 'draft'),
    countByStatus(generatedContent, 'approved'),
    approvedQueue?.length ?? 0,
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Pipeline</h2>

      {/* Pipeline Flow — com volumes reais */}
      <Card>
        <CardHeader>
          <CardTitle>Fluxo do Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {PIPELINE_STAGE_DEFS.map((stage, i) => {
              const vol = stageVolumes[i]
              const hasItems = vol > 0
              return (
                <div key={stage.name} className="flex items-center gap-2">
                  <div className={`flex flex-col items-center rounded-lg border p-4 min-w-[120px] transition-colors ${hasItems ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}>
                    <span className="text-2xl">{stage.icon}</span>
                    <span className="text-sm font-medium mt-1">{stage.name}</span>
                    <span className="text-xs text-muted-foreground">{stage.desc}</span>
                    <span className={`text-lg font-bold mt-2 tabular-nums ${hasItems ? 'text-primary' : 'text-muted-foreground'}`}>
                      {vol}
                    </span>
                  </div>
                  {i < PIPELINE_STAGE_DEFS.length - 1 && (
                    <span className="text-muted-foreground text-lg">&rarr;</span>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Content Funnel */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trending Topics (Funnel)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {['new', 'curating', 'curated', 'stale'].map(status => (
                <div key={status}>
                  <p className="text-xs text-muted-foreground capitalize">{status}</p>
                  <p className="text-lg font-semibold">{countByStatus(trendingTopics, status)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Generated Content (Funnel)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {['draft', 'approved', 'rejected', 'published'].map(status => (
                <div key={status}>
                  <p className="text-xs text-muted-foreground capitalize">{status}</p>
                  <p className="text-lg font-semibold">{countByStatus(generatedContent, status)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Content Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Fila de Aprovados ({approvedQueue?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentQueue items={approvedQueue ?? []} />
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card>
        <CardHeader>
          <CardTitle>Execucoes Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {pipelineRuns && pipelineRuns.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Duracao</TableHead>
                  <TableHead>Stages</TableHead>
                  <TableHead>Inicio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipelineRuns.map((run: { id: string; status: string | null; started_at: string | null; completed_at: string | null; stages_completed: string[] | null; trigger: string | null }) => (
                  <TableRow key={run.id}>
                    <TableCell>{statusBadge(run.status)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.trigger}</Badge>
                    </TableCell>
                    <TableCell>{formatDuration(run.started_at, run.completed_at)}</TableCell>
                    <TableCell>{run.stages_completed?.length ?? 0}/5</TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(run.started_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma execucao de pipeline ainda. Use /pipeline no Telegram ou configure o scheduler.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
