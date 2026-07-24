import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/scheduler/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: scheduler trend pipeline', () => {
  it('dispara pipeline trend completo na ordem certa', () => {
    const discoveryIndex = SRC.indexOf("'/api/cron/trend-discovery-br'")
    const rerankIndex = SRC.indexOf("'/api/cron/trend-topics-rerank'")
    const prepareIndex = SRC.indexOf("'/api/cron/trend-creative-prepare'")
    const animateIndex = SRC.indexOf("await runInternalCron(baseUrl, '/api/cron/trend-video-animate')")
    const publishIndex = SRC.indexOf("await runInternalCron(baseUrl, '/api/cron/trend-video-publish')")
    const metricsIndex = SRC.indexOf("await runInternalCron(baseUrl, '/api/cron/trend-video-metrics')")

    expect(discoveryIndex).toBeGreaterThan(-1)
    expect(rerankIndex).toBeGreaterThan(-1)
    expect(prepareIndex).toBeGreaterThan(-1)
    expect(animateIndex).toBeGreaterThan(-1)
    expect(publishIndex).toBeGreaterThan(-1)
    expect(metricsIndex).toBeGreaterThan(-1)
    expect(discoveryIndex).toBeLessThan(rerankIndex)
    expect(rerankIndex).toBeLessThan(prepareIndex)
    expect(prepareIndex).toBeLessThan(animateIndex)
    expect(animateIndex).toBeLessThan(publishIndex)
    expect(publishIndex).toBeLessThan(metricsIndex)
  })

  it('usa runInternalCron autenticado para os crons internos', () => {
    expect(SRC).toContain('async function runInternalCron')
    expect(SRC).toContain('Authorization: `Bearer ${process.env.CRON_SECRET}`')
    expect(SRC).toContain('await runInternalCron(baseUrl, path)')
  })

  it('so chama publish e metrics quando houver elegibilidade', () => {
    expect(SRC).toContain('async function hasTrendVideoJobToAnimate')
    expect(SRC).toContain('async function countTrendVideoJobsToAnimate')
    expect(SRC).toContain('async function countReadyTrendVideoJobs')
    expect(SRC).toContain('async function countPublishedTrendVideoJobsToSync')
    expect(SRC).toContain('TREND_VIDEO_ANIMATE_STATUSES')
    expect(SRC).toContain(".in('status', [...TREND_VIDEO_ANIMATE_STATUSES])")
    expect(SRC).toContain('TREND_VIDEO_METRICS_WINDOW_DAYS')
    expect(SRC).toContain('if (animateEligible > 0 && await hasTrendVideoJobToAnimate(supabase))')
    expect(SRC).toContain('async function hasReadyTrendVideoJob')
    expect(SRC).toContain('async function hasPublishedTrendVideoJobToSync')
    expect(SRC).toContain('if (publishEligible > 0 && await hasReadyTrendVideoJob(supabase))')
    expect(SRC).toContain('if (metricsEligible > 0 && await hasPublishedTrendVideoJobToSync(supabase))')
    expect(SRC).toContain('countPendingInstagramCommentInteractions')
    expect(SRC).toContain('countPendingInstagramDmInteractions')
    expect(SRC).toContain("await runInternalCron(baseUrl, '/api/cron/instagram-comments')")
    expect(SRC).toContain("await runInternalCron(baseUrl, '/api/cron/instagram-giveaway-delivery')")
  })

  it('destrava itens presos em publishing para TODOS os workspaces a cada tick, antes do loop de isDue()', () => {
    // Bug 2026-07-14: a lógica de destravar 'publishing' só rodava dentro do execute() do
    // próprio agente publisher, cujo schedule_cron pode ser tão raro quanto 3x/dia (brand
    // Mob) — um item órfão podia ficar preso por até ~16h. Fix: scheduler roda o unstick
    // globalmente a cada 5 min, para todo workspace com algum agente ativo, independente
    // de isDue().
    expect(SRC).toContain("import { unstickPublishingItems } from '@/lib/agents/publisher/index'")
    expect(SRC).toContain('const workspaceIds = [...new Set(agents.map(a => a.workspace_id))]')
    expect(SRC).toContain('await unstickPublishingItems(supabase, workspaceId, retryAttempts || 3)')

    // Precisa rodar ANTES do loop `for (const agent of agents)` que é gated por isDue() —
    // senão o unstick herdaria o mesmo problema de cadência infrequente que está sendo corrigido.
    const unstickIndex = SRC.indexOf('const workspaceIds = [...new Set(agents.map(a => a.workspace_id))]')
    const isDueLoopIndex = SRC.indexOf('for (const agent of agents)')
    expect(unstickIndex).toBeGreaterThan(-1)
    expect(isDueLoopIndex).toBeGreaterThan(-1)
    expect(unstickIndex).toBeLessThan(isDueLoopIndex)
  })

  it('retorna resumo operacional de elegibilidade', () => {
    expect(SRC).toContain('getTrendVideoOpsObservabilityConfig')
    expect(SRC).toContain('trendVideoConfig: getTrendVideoOpsObservabilityConfig(),')
    expect(SRC).toContain('trendVideoEligibility: {')
    expect(SRC).toContain('animateEligible,')
    expect(SRC).toContain('publishEligible,')
    expect(SRC).toContain('metricsEligible,')
    expect(SRC).toContain('giveawayEligibility: {')
    expect(SRC).toContain('commentEligible: giveawayCommentEligible,')
    expect(SRC).toContain('dmEligible: giveawayDmEligible,')
    expect(SRC).toContain('getTrendVideoCurrentBottleneck')
    expect(SRC).toContain('const trendVideoBottleneck = getTrendVideoCurrentBottleneck({')
    expect(SRC).toContain('trendVideoBottleneck,')
  })
})
