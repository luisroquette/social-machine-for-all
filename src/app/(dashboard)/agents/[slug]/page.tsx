import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAdminClient } from '@/lib/supabase/admin'
import { getActiveWorkspaceId } from '@/lib/config/workspace'

function relativeTime(date: string | null): string {
  if (!date) return 'never'
  const diff = Date.now() - new Date(date).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function sparklinePath(values: number[], w = 120, h = 32): string {
  if (values.length < 2) return ''
  const max = Math.max(...values, 1)
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
  return `M${pts.join('L')}`
}

export default async function AgentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = getAdminClient()
  const WORKSPACE_ID = await getActiveWorkspaceId()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: agentRow },
    { data: recentActions },
    { data: evals },
  ] = await Promise.all([
    supabase
      .from('agents')
      .select('slug, name, role, model, active, schedule_enabled, last_run_at, total_runs, avg_score, system_prompt')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('slug', slug)
      .single(),
    supabase
      .from('agent_actions')
      .select('action_type, status, output_summary, created_at, agents!inner(slug)')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('agents.slug', slug)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('eval_dataset')
      .select('auto_score, verdict, issues, created_at')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('agent_slug', slug)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: true }),
  ])

  if (!agentRow) notFound()

  const agent = agentRow

  // Score evolution (last 14 evals bucketed)
  const scoreHistory = (evals ?? []).map(e => e.auto_score ?? 0)
  const sparkD = sparklinePath(scoreHistory)

  // Issue frequency
  const issueCounts: Record<string, number> = {}
  for (const e of evals ?? []) {
    for (const issue of e.issues ?? []) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1
    }
  }
  const topIssues = Object.entries(issueCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)

  // Action stats
  const actions = recentActions ?? []
  const errorActions = actions.filter(a => a.status === 'error')
  const successActions = actions.filter(a => a.status === 'success')

  const avgScore = (evals ?? []).length > 0
    ? (evals!.reduce((s, e) => s + (e.auto_score ?? 0), 0) / evals!.length).toFixed(1)
    : null

  const approvalRate = (evals ?? []).length > 0
    ? (((evals!.filter(e => e.verdict === 'keep').length) / evals!.length) * 100).toFixed(0)
    : null

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/agents" className="hover:text-foreground transition-colors">Agentes</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{agent.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{agent.name}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="secondary">{agent.role}</Badge>
            <Badge variant={agent.active ? 'default' : 'destructive'}>
              {agent.active ? 'active' : 'paused'}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{agent.model ?? '--'}</span>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Última execução: {relativeTime(agent.last_run_at)}</div>
          <div>Total runs: {agent.total_runs ?? 0}</div>
          <div>Schedule: {agent.schedule_enabled ? 'ativo' : 'off'}</div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Score Médio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgScore ?? '--'}</div>
            <p className="text-xs text-muted-foreground">últimos 30 dias</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa Aprovação</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvalRate != null ? `${approvalRate}%` : '--'}</div>
            <p className="text-xs text-muted-foreground">keep vs reject</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Erros Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{errorActions.length}</div>
            <p className="text-xs text-muted-foreground">últimas 30 ações</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sucesso Recente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{successActions.length}</div>
            <p className="text-xs text-muted-foreground">últimas 30 ações</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Score Evolution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Evolução do Score</CardTitle>
          </CardHeader>
          <CardContent>
            {sparkD ? (
              <div className="space-y-2">
                <svg width="100%" height={48} viewBox={`0 0 120 32`} preserveAspectRatio="none" className="w-full">
                  <path d={sparkD} fill="none" stroke="hsl(142 76% 36%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>30d atrás</span>
                  <span>hoje</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sem dados de avaliação no período.</p>
            )}
          </CardContent>
        </Card>

        {/* Top Issues */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Issues Frequentes</CardTitle>
          </CardHeader>
          <CardContent>
            {topIssues.length > 0 ? (
              <div className="space-y-2">
                {topIssues.map(([issue, count]) => (
                  <div key={issue} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground truncate flex-1">{issue}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full"
                          style={{ width: `${(count / (topIssues[0]?.[1] ?? 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-4 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum issue registrado.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Ações Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {actions.length > 0 ? (
            <div className="space-y-1">
              {actions.map((action, idx) => {
                const isError = action.status === 'error'
                return (
                  <div key={idx} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
                    <span className={`text-xs font-mono mt-0.5 w-3 shrink-0 ${isError ? 'text-red-500' : 'text-green-500'}`}>
                      {isError ? '✗' : '✓'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground">{action.action_type}</span>
                      {action.output_summary && (
                        <span className="text-xs text-muted-foreground ml-2">— {action.output_summary.slice(0, 100)}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{relativeTime(action.created_at)}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma ação registrada.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
