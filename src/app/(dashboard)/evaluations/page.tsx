import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAdminClient } from '@/lib/supabase/admin'


interface EvalRow {
  agent_slug: string
  auto_score: number | null
  verdict: string | null
  issues: string[] | null
  created_at: string | null
}

export default async function EvaluationsPage() {
  const supabase = getAdminClient()
  const WORKSPACE_ID = await getActiveWorkspaceId()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: evals } = await supabase
    .from('eval_dataset')
    .select('agent_slug, auto_score, verdict, issues, created_at')
    .eq('workspace_id', WORKSPACE_ID)
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })

  const allEvals: EvalRow[] = evals ?? []
  const totalEvals = allEvals.length
  const avgScore = totalEvals > 0
    ? allEvals.reduce((sum, e) => sum + (e.auto_score ?? 0), 0) / totalEvals
    : null
  const keepCount = allEvals.filter(e => e.verdict === 'keep').length
  const approvalRate = totalEvals > 0
    ? ((keepCount / totalEvals) * 100).toFixed(1)
    : null

  // Group by agent
  const agentSlugs = [...new Set(allEvals.map(e => e.agent_slug))].sort()
  const byAgent: Record<string, EvalRow[]> = {}
  for (const slug of agentSlugs) {
    byAgent[slug] = allEvals.filter(e => e.agent_slug === slug)
  }

  // Aggregate top issues per agent
  function topIssues(rows: EvalRow[], limit = 5): { issue: string; count: number }[] {
    const counts: Record<string, number> = {}
    for (const row of rows) {
      if (row.issues && Array.isArray(row.issues)) {
        for (const issue of row.issues) {
          counts[issue] = (counts[issue] ?? 0) + 1
        }
      }
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([issue, count]) => ({ issue, count }))
  }

  const defaultTab = agentSlugs.includes('writer') ? 'writer' : agentSlugs[0] ?? 'none'

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Avaliacoes</h2>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total de Avaliacoes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEvals}</div>
            <p className="text-xs text-muted-foreground">ultimos 30 dias</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Score Medio Global</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgScore != null ? avgScore.toFixed(1) : '--'}</div>
            <p className="text-xs text-muted-foreground">todos os agentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa de Aprovacao</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvalRate != null ? `${approvalRate}%` : '--'}</div>
            <p className="text-xs text-muted-foreground">keep vs reject</p>
          </CardContent>
        </Card>
      </div>

      {/* Score por agente — gráfico de barras */}
      {agentSlugs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Score por Agente — últimos 30 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {agentSlugs.map(slug => {
                const rows = byAgent[slug]
                const score = rows.length > 0
                  ? rows.reduce((s, e) => s + (e.auto_score ?? 0), 0) / rows.length
                  : 0
                const pct = Math.min((score / 10) * 100, 100)
                const color = score >= 7 ? 'bg-green-500' : score >= 5 ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <div key={slug} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground w-32 shrink-0 truncate">{slug}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono w-8 text-right">{score > 0 ? score.toFixed(1) : '--'}</span>
                    <span className="text-xs text-muted-foreground w-12 text-right">{rows.length}x</span>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"/>≥ 7.0</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"/>5.0–6.9</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>{'< 5.0'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Agent Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Performance por Agente</CardTitle>
        </CardHeader>
        <CardContent>
          {agentSlugs.length > 0 ? (
            <Tabs defaultValue={defaultTab}>
              <TabsList>
                {agentSlugs.map(slug => (
                  <TabsTrigger key={slug} value={slug} className="text-xs">
                    {slug}
                  </TabsTrigger>
                ))}
              </TabsList>
              {agentSlugs.map(slug => {
                const rows = byAgent[slug]
                const count = rows.length
                const agentAvg = count > 0
                  ? (rows.reduce((s, e) => s + (e.auto_score ?? 0), 0) / count).toFixed(1)
                  : '--'
                const approved = rows.filter(e => e.verdict === 'keep').length
                const rejected = rows.filter(e => e.verdict === 'reject').length
                const issues = topIssues(rows)

                return (
                  <TabsContent key={slug} value={slug}>
                    <div className="py-4">
                      <div className="grid gap-4 md:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Avaliacoes</p>
                          <p className="text-lg font-semibold">{count}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Score Medio</p>
                          <p className="text-lg font-semibold">{agentAvg}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Aprovados</p>
                          <p className="text-lg font-semibold text-green-600">{approved}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Rejeitados</p>
                          <p className="text-lg font-semibold text-red-600">{rejected}</p>
                        </div>
                      </div>
                      {issues.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs text-muted-foreground mb-2">Top Issues</p>
                          <div className="flex flex-wrap gap-2">
                            {issues.map(({ issue, count: c }) => (
                              <Badge key={issue} variant="outline">
                                {issue} ({c})
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                )
              })}
            </Tabs>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem dados de avaliacao nos ultimos 30 dias. Execute o pipeline para gerar avaliacoes.
            </p>
          )}
        </CardContent>
      </Card>


    </div>
  )
}
