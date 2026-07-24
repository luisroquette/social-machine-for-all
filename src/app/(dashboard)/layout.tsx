import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { LogoutButton } from '@/components/logout-button'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { WorkspaceProvider } from '@/components/workspace-provider'
import { redirect } from 'next/navigation'

async function getSystemStatus(workspaceId: string): Promise<{ level: 'ok' | 'warn' | 'error'; label: string }> {
  try {
    const supabase = getAdminClient()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: errorCount } = await supabase
      .from('agent_actions')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'error')
      .gte('created_at', oneHourAgo)
    const errors = errorCount ?? 0
    if (errors >= 3) return { level: 'error', label: `${errors} erros/h` }
    if (errors > 0)  return { level: 'warn',  label: `${errors} erro/h` }
    return { level: 'ok', label: 'Sistema ok' }
  } catch {
    return { level: 'warn', label: 'Status indisponível' }
  }
}

const STATUS_STYLES = {
  ok:    { dot: 'bg-green-500',  text: 'text-green-600 dark:text-green-400' },
  warn:  { dot: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400' },
  error: { dot: 'bg-red-500',    text: 'text-red-600 dark:text-red-400' },
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const activeWorkspaceId = await getActiveWorkspaceId()
  const adminSupabase = getAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  const [status, { data: workspaces }] = await Promise.all([
    getSystemStatus(activeWorkspaceId),
    adminSupabase.from('workspaces').select('id, name').eq('owner_id', user?.id ?? '').order('name'),
  ])

  if (user && (!workspaces || workspaces.length === 0)) redirect('/onboarding')

  const styles = STATUS_STYLES[status.level]

  return (
    <WorkspaceProvider workspaceId={activeWorkspaceId}>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="container mx-auto flex h-14 items-center px-6">
            <h1 className="text-lg font-semibold">Social Machine v3.1</h1>
            <nav className="ml-8 flex gap-4 text-sm">
              <a href="/" className="text-muted-foreground hover:text-foreground transition-colors">Overview</a>
              <a href="/agents" className="text-muted-foreground hover:text-foreground transition-colors">Agents</a>
              <a href="/pipeline" className="text-muted-foreground hover:text-foreground transition-colors">Pipeline</a>
              <a href="/trend-video" className="text-muted-foreground hover:text-foreground transition-colors">Trend Video</a>
              <a href="/evaluations" className="text-muted-foreground hover:text-foreground transition-colors">Evaluations</a>
              <a href="/settings" className="text-muted-foreground hover:text-foreground transition-colors">Settings</a>
            </nav>
            <div className="ml-auto flex items-center gap-4">
              {workspaces && workspaces.length > 1 && (
                <WorkspaceSwitcher
                  workspaces={workspaces}
                  activeId={activeWorkspaceId}
                />
              )}
              <span className={`flex items-center gap-1.5 text-xs font-medium ${styles.text}`}>
                <span className={`w-2 h-2 rounded-full ${styles.dot} ${status.level === 'ok' ? 'animate-pulse' : ''}`} />
                {status.label}
              </span>
              {user && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{user.email}</span>
                  <LogoutButton />
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="container mx-auto px-6 py-6">
          {children}
        </main>
      </div>
    </WorkspaceProvider>
  )
}
