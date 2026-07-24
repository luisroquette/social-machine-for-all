import Link from 'next/link'
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

export default async function AgentsPage() {
  const supabase = getAdminClient()
  const WORKSPACE_ID = await getActiveWorkspaceId()

  const { data: agents } = await supabase
    .from('agents')
    .select('slug, name, role, model, active, schedule_enabled, last_run_at, total_runs, avg_score')
    .eq('workspace_id', WORKSPACE_ID)
    .order('name')

  const agentCount = agents?.length ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Agentes</h2>
        <Badge variant="outline">{agentCount} agentes registrados</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registro de Agentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ultima Execucao</TableHead>
                <TableHead>Total Runs</TableHead>
                <TableHead>Score Medio</TableHead>
                <TableHead>Schedule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents && agents.length > 0 ? (
                agents.map((a: {
                  slug: string
                  name: string
                  role: string
                  model: string | null
                  active: boolean | null
                  schedule_enabled: boolean | null
                  last_run_at: string | null
                  total_runs: number | null
                  avg_score: number | null
                }) => (
                  <TableRow key={a.slug} className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium">
                      <Link href={`/agents/${a.slug}`} className="hover:underline">{a.name}</Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{a.role}</Badge>
                    </TableCell>
                    <TableCell>{a.model ?? '--'}</TableCell>
                    <TableCell>
                      <Badge variant={a.active ? 'default' : 'destructive'}>
                        {a.active ? 'active' : 'paused'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(a.last_run_at)}</TableCell>
                    <TableCell>{a.total_runs ?? 0}</TableCell>
                    <TableCell>{a.avg_score != null ? a.avg_score.toFixed(1) : '--'}</TableCell>
                    <TableCell>
                      <Badge variant={a.schedule_enabled ? 'default' : 'outline'}>
                        {a.schedule_enabled ? 'enabled' : 'off'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Nenhum agente registrado ainda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}
