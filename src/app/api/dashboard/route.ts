import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  // Auth check (Q2)
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
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Fetch all dashboard data in parallel
  const [agentsRes, pipelineRes, topicsRes, contentRes, errorsRes] = await Promise.all([
    supabase
      .from('agents')
      .select('slug, name, active, schedule_enabled, last_run_at, total_runs, avg_score')
      .eq('workspace_id', workspaceId)
      .order('slug'),
    supabase
      .from('pipeline_runs')
      .select('id, status, started_at, completed_at, stages_completed, trigger')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('trending_topics')
      .select('id, title, relevance, status, detected_at')
      .eq('workspace_id', workspaceId)
      .gte('detected_at', oneDayAgo)
      .order('detected_at', { ascending: false }),
    supabase
      .from('generated_content')
      .select('id, status, target_platform, created_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', oneDayAgo),
    supabase
      .from('agent_actions')
      .select('id, agent_id, action_type, status, duration_ms, created_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'error')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Aggregate content stats
  const contentList = (contentRes.data ?? []) as Array<{ status: string }>
  const contentStats = {
    drafts: contentList.filter(c => c.status === 'draft').length,
    approved: contentList.filter(c => c.status === 'approved').length,
    published: contentList.filter(c => c.status === 'published').length,
    rejected: contentList.filter(c => c.status === 'rejected').length,
  }

  return NextResponse.json({
    agents: agentsRes.data ?? [],
    pipelineRuns: pipelineRes.data ?? [],
    trendingTopics: topicsRes.data ?? [],
    contentStats,
    recentErrors: errorsRes.data ?? [],
  })
}
