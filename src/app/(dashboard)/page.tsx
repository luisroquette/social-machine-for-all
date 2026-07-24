import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getAdminClient } from '@/lib/supabase/admin'


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

function sparklinePath(values: number[], w = 80, h = 24): string {
  if (values.length < 2) return ''
  const max = Math.max(...values, 1)
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
  return `M${pts.join('L')}`
}

function Sparkline({ values, color = 'currentColor' }: { values: number[]; color?: string }) {
  const d = sparklinePath(values)
  if (!d) return null
  return (
    <svg width={80} height={24} viewBox="0 0 80 24" className="opacity-60">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default async function DashboardPage() {
  const supabase = getAdminClient()
  const WORKSPACE_ID = await getActiveWorkspaceId()

  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: activeAgents },
    { count: trendingCount },
    { count: publishedCount },
    { count: errorCount },
    { data: agents },
    { data: pipelineRuns },
    { data: publishedHistory },
    { data: errorHistory },
    { data: recentActivity },
  ] = await Promise.all([
    supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('active', true),
    supabase
      .from('trending_topics')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .gte('detected_at', twentyFourHoursAgo),
    supabase
      .from('generated_content')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'published')
      .gte('published_at', twentyFourHoursAgo),
    supabase
      .from('agent_actions')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'error')
      .gte('created_at', oneHourAgo),
    supabase
      .from('agents')
      .select('slug, name, active, last_run_at, total_runs, avg_score')
      .eq('workspace_id', WORKSPACE_ID)
      .order('name'),
    supabase
      .from('pipeline_runs')
      .select('id, status, started_at, completed_at, stages_completed, trigger')
      .eq('workspace_id', WORKSPACE_ID)
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('generated_content')
      .select('published_at')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'published')
      .gte('published_at', sevenDaysAgo)
      .not('published_at', 'is', null),
    supabase
      .from('agent_actions')
      .select('created_at')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'error')
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('agent_actions')
      .select('action_type, status, created_at, output_summary, agents(slug)')
      .eq('workspace_id', WORKSPACE_ID)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  // Bucket published content by day (last 7 days)
  const publishedByDay = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    return (publishedHistory ?? []).filter(r => {
      const d = new Date(r.published_at as string)
      return d >= dayStart && d < dayEnd
    }).length
  })

  // Bucket errors by day (last 7 days)
  const errorsByDay = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    return (errorHistory ?? []).filter(r => {
      if (!r.created_at) return false
      const d = new Date(r.created_at)
      return d >= dayStart && d < dayEnd
    }).length
  })

  const totalAgents = agents?.length ?? 0

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Overview</h2>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agents Ativos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeAgents ?? 0}</div>
            <p className="text-xs text-muted-foreground">de {totalAgents} configurados</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Trending Topics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{trendingCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">ultimas 24h</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conteudo Publicado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold">{publishedCount ?? 0}</div>
                <p className="text-xs text-muted-foreground">ultimas 24h</p>
              </div>
              <Sparkline values={publishedByDay} color="hsl(142 76% 36%)" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Erros Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold">{errorCount ?? 0}</div>
                <p className="text-xs text-muted-foreground">ultima hora</p>
              </div>
              <Sparkline values={errorsByDay} color="hsl(0 84% 60%)" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agents Status */}
      <Card>
        <CardHeader>
          <CardTitle>Status dos Agentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ultima Execucao</TableHead>
                <TableHead>Total Runs</TableHead>
                <TableHead>Score Medio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents && agents.length > 0 ? (
                agents.map((agent: { slug: string; name: string; active: boolean | null; last_run_at: string | null; total_runs: number | null; avg_score: number | null }) => (
                  <TableRow key={agent.slug}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>
                      <Badge variant={agent.active ? 'default' : 'secondary'}>
                        {agent.active ? 'active' : 'paused'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(agent.last_run_at)}</TableCell>
                    <TableCell>{agent.total_runs ?? 0}</TableCell>
                    <TableCell>{agent.avg_score != null ? agent.avg_score.toFixed(1) : '--'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhum agente registrado ainda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pipeline Runs */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Runs Recentes</CardTitle>
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
            <p className="text-sm text-muted-foreground">Nenhuma execucao de pipeline ainda.</p>
          )}
        </CardContent>
      </Card>

      {/* Atividade Recente */}
      {recentActivity && recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Atividade Recente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {recentActivity.map((action: {
                action_type: string
                status: string | null
                created_at: string | null
                output_summary: string | null
                agents: { slug: string } | null
              }, idx: number) => {
                const isError = action.status === 'error'
                const icon = isError ? '✗' : action.action_type === 'publish' ? '↑' : '·'
                const iconColor = isError ? 'text-red-500' : action.action_type === 'publish' ? 'text-green-500' : 'text-muted-foreground'
                return (
                  <div key={idx} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
                    <span className={`text-xs font-mono mt-0.5 w-3 shrink-0 ${iconColor}`}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground">{action.agents?.slug ?? '—'}</span>
                      <span className="text-xs text-muted-foreground mx-1.5">·</span>
                      <span className="text-xs">{action.action_type}</span>
                      {action.output_summary && (
                        <span className="text-xs text-muted-foreground ml-1.5 truncate">— {action.output_summary.slice(0, 80)}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{relativeTime(action.created_at)}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
