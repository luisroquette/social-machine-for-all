/**
 * REGRESSÃO: reels-publish — §5 título duplo na capa (bug histórico, 2026-05-19)
 *
 * Bug: generateEditorialCover rodava APÓS Promise.allSettled([renderCover(), renderVideo()]).
 * O Railway renderizava o CoverImage e sobrescrevia covers/bg-{id}.png no Supabase com
 * o cover já com título. Quando o Satori buscava o mesmo URL, recebia o cover do Remotion
 * (com título embutido) como background → Satori desenhava o título por cima → título duplo.
 *
 * Fix: rodar generateEditorialCover EM PARALELO com renderCover/renderVideo via Promise.allSettled.
 * O Satori busca o bg URL ao mesmo tempo que o Railway começa a renderizar, antes de qualquer
 * sobrescrita possível no Supabase.
 *
 * Garantia deste teste:
 * - generateEditorialCover recebe backgroundUrl = reelData.backgroundUrl (foto bruta OpenAI)
 * - NÃO recebe coverResult.value (output do Remotion com título)
 * - A chamada ao /api/og/reel inclui `bg=` com a URL bruta da OpenAI, não do Remotion
 *
 * ---
 *
 * REGRESSÃO: reels-publish deve usar getInstagramCredentials(WORKSPACE_ID), nunca env vars.
 *
 * Bug histórico: a rota usava process.env.INSTAGRAM_USER_ID e INSTAGRAM_ACCESS_TOKEN
 * diretamente — credenciais do @brand. Mesmo com WORKSPACE_ID = AI & Tech,
 * todo conteúdo ia para @brand (5 reels contaminados em 17/05/2026).
 *
 * Garantias:
 * 1. Quando getInstagramCredentials retorna vazio (sem creds no DB), a rota retorna erro
 *    "IG credentials missing for workspace" — prova que passou pelo DB, não pelo env var.
 * 2. Se env vars têm creds do Brand mas DB do WORKSPACE_ID está vazio,
 *    a rota NÃO usa as env vars (falha com erro de credencial, não chega a publicar).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock de load-credentials (deve ser o primeiro vi.mock) ──────────────────

const mockGetInstagramCredentials = vi.fn()

vi.mock('@/lib/settings/load-credentials', () => ({
  getInstagramCredentials: mockGetInstagramCredentials,
  checkCredentialHealth: vi.fn().mockResolvedValue([]),
}))

// ── Mock do Supabase (retorna reel_ready item) ──────────────────────────────

const SAMPLE_REEL_CONTENT = JSON.stringify({
  videoUrl: 'https://example.com/video.mp4',
  backgroundUrl: 'https://example.com/bg.png',
  subtitles: [],
  hookTitle: 'Test Hook',
  highlightWords: ['Test'],
  subtitle: 'test subtitle',
  caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
  sourceAuthor: 'testauthor',
})

const mockLimit = vi.fn()
const mockOrder = vi.fn(() => ({ limit: mockLimit }))
const mockEqStatus = vi.fn(() => ({ order: mockOrder }))
const mockEqFormat = vi.fn(() => ({ eq: mockEqStatus }))
const mockEqWorkspace = vi.fn(() => ({ eq: mockEqFormat }))
const mockSelect = vi.fn(() => ({ eq: mockEqWorkspace }))
const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect, update: mockUpdate }))
const mockStorageUpload = vi.fn().mockResolvedValue({ error: null })
const mockStorageGetPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/editorial-cover.png' } })
const mockStorageFrom = vi.fn(() => ({ upload: mockStorageUpload, getPublicUrl: mockStorageGetPublicUrl }))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFrom, storage: { from: mockStorageFrom } }),
}))

// ── Mock de load-settings ───────────────────────────────────────────────────

vi.mock('@/lib/settings/load-settings', () => ({
  getVariable: vi.fn().mockResolvedValue('thedoomguy_ai'),
  getNumericVariable: vi.fn().mockResolvedValue(5000),
}))

// ── Mock de autenticação de cron ────────────────────────────────────────────

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: vi.fn().mockReturnValue(true),
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadRoute() {
  const mod = await import('./route')
  return mod
}

function makeCronRequest(qs = '') {
  return new NextRequest(`http://localhost/api/cron/reels-publish${qs}`, {
    headers: { Authorization: 'Bearer test-cron-secret' },
  })
}

function makeBrandRequest() {
  return makeCronRequest('?workspaceId=00000000-0000-0000-0000-000000000000')
}

// ── Testes ───────────────────────────────────────────────────────────────────

describe('REGRESSÃO: reels-publish — isolamento de credenciais por workspace', () => {
  beforeEach(() => {
    vi.resetModules()
    // Env vars têm APENAS credenciais do Brand — nunca devem ser usadas pelo reels-publish de AI & Tech
    process.env.INSTAGRAM_USER_ID = 'brandMOB_17841471659935614'
    process.env.INSTAGRAM_ACCESS_TOKEN = 'brandMOB_EAAcjX_TOKEN'
    process.env.CRON_SECRET = 'test-cron-secret'
    // Permite que generateEditorialCover construa a URL da capa (Satori)
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockReset()
    mockLimit.mockReset()
    // Stub fetch: Remotion cover render e Satori og/reel retornam sucesso
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
      json: async () => ({ url: 'https://example.com/rendered-cover.png' }),
    }))
  })

  it('rota retorna erro de credencial quando getInstagramCredentials retorna vazio — prova que NÃO usou env vars', async () => {
    // DB do AI & Tech não tem credenciais Instagram configuradas
    mockGetInstagramCredentials.mockResolvedValue({ appId: '', igUserId: '', accessToken: '' })
    mockLimit.mockResolvedValue({ data: [{ id: 'item-1', content: SAMPLE_REEL_CONTENT }] })

    const { GET } = await loadRoute()
    const res = await GET(makeCronRequest('?workspaceId=22222222-2222-4222-8222-222222222222'))
    const body = await res.json()

    // Deve falhar com erro de credencial de workspace, não tentar publicar com creds do brand
    expect(body.ok).toBe(false)
    expect(body.error).toBe('IG credentials missing for workspace')

    // Confirma que chamou getInstagramCredentials (não leu process.env diretamente)
    expect(mockGetInstagramCredentials).toHaveBeenCalledOnce()
    expect(mockGetInstagramCredentials).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    )
  })

  it('getInstagramCredentials é chamado com WORKSPACE_ID do AI & Tech, nunca com Brand ID', async () => {
    mockGetInstagramCredentials.mockResolvedValue({ appId: '', igUserId: '', accessToken: '' })
    mockLimit.mockResolvedValue({ data: [{ id: 'item-2', content: SAMPLE_REEL_CONTENT }] })

    const { GET } = await loadRoute()
    await GET(makeCronRequest('?workspaceId=22222222-2222-4222-8222-222222222222'))

    const callArg = mockGetInstagramCredentials.mock.calls[0]?.[0]
    // Nunca pode chamar com o workspace ID do Brand
    expect(callArg).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('sem itens reel_ready — rota retorna skipped sem chamar credenciais', async () => {
    mockLimit.mockResolvedValue({ data: [] })

    const { GET } = await loadRoute()
    const res = await GET(makeCronRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.skipped).toBe('no_reel_ready')
    // Não chegou a chamar getInstagramCredentials
    expect(mockGetInstagramCredentials).not.toHaveBeenCalled()
  })
})

// ── Cycling prevention — publish_failed sentinel stops infinite prepare→publish loop ─

describe('REGRESSÃO: reels-publish — cycling prevention via publish_failed sentinel (bug 2026-05-23)', () => {
  const CURATED_ID = 'curated-dfececed-uuid'
  const CYCLING_CONTENT = JSON.stringify({
    videoUrl: 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/downloads/dfececed.mp4',
    backgroundUrl: 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/covers/bg-dfececed.png',
    subtitles: [],
    hookTitle: 'IA QUE SUBSTITUI PROGRAMADORES',
    highlightWords: ['IA', 'PROGRAMADORES'],
    subtitle: 'futuro do trabalho',
    caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
    sourceAuthor: 'fabianstelzer',
  })

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockReset()
    mockGetInstagramCredentials.mockResolvedValue({
      appId: 'app-123',
      igUserId: 'ig-user-123',
      accessToken: 'ig-token-abc',
    })
    mockLimit.mockReset()
    mockUpdate.mockClear()
    mockUpdateEq.mockClear()
  })

  it('IG poll ERROR → armazena review_feedback (não null) e bloqueia curated_content com publish_failed por 24h', async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-cycle', content: CYCLING_CONTENT, curated_content_id: CURATED_ID }],
    })

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/og/')) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }
      if (u.includes('/render/')) return { ok: true, status: 200, json: async () => ({ url: 'https://railway.app/rendered.mp4' }) }
      // IG error detail — ids= format with video_status field
      if (u.includes('video_status')) return { ok: true, status: 200, json: async () => ({ 'ig-container-123': { video_status: { status: 'ERROR', processing_progress: 0 } } }) }
      // IG status poll — ids= format, returns ERROR to trigger error path
      if (u.includes('status_code')) return { ok: true, status: 200, json: async () => ({ 'ig-container-123': { status_code: 'ERROR' } }) }
      // IG container creation and other IG calls
      return { ok: true, status: 200, json: async () => ({ id: 'ig-container-123' }), arrayBuffer: async () => new ArrayBuffer(8) }
    }))

    vi.useFakeTimers()
    const { GET } = await loadRoute()
    const routePromise = GET(makeCronRequest())
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await routePromise
    vi.useRealTimers()

    const body = await res.json()

    // Rota falha com Instagram reject
    expect(body.ok).toBe(false)
    expect(body.error).toBe('IG publish failed')

    // detail contém o detalhe do erro (nunca null/undefined)
    expect(body.detail).toBeDefined()
    expect(body.detail).toMatch(/IG_ERROR/)

    const allUpdateCalls = mockUpdate.mock.calls as unknown[][]

    // generated_content.update deve ter review_feedback com detalhe (não null)
    const gcFailUpdate = allUpdateCalls.find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.status === 'failed' && typeof d.review_feedback === 'string' && (d.review_feedback as string).startsWith('IG_ERROR')
    })
    expect(gcFailUpdate).toBeDefined()

    // curated_content.update com skip_reason=publish_failed — QUEBRA O CICLO INFINITO
    const sentinelUpdate = allUpdateCalls.find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.skip_reason === 'publish_failed'
    })
    expect(sentinelUpdate).toBeDefined()

    // skip_until deve ser ~24h no futuro (entre 23h e 25h a partir de agora)
    const sentinelData = (sentinelUpdate as unknown[])[0] as Record<string, unknown>
    const skipUntilMs = new Date(sentinelData.skip_until as string).getTime()
    const nowMs = Date.now()
    expect(skipUntilMs).toBeGreaterThan(nowMs + 23 * 60 * 60 * 1000)
    expect(skipUntilMs).toBeLessThan(nowMs + 25 * 60 * 60 * 1000)
  })
})

// ── §5: Título duplo — Satori NUNCA recebe output do Remotion como background ─

describe('REGRESSÃO: reels-publish §5 — fundo Satori = foto bruta OpenAI, nunca Remotion (bug 2026-05-19)', () => {
  const RAW_OPENAI_BG = 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/covers/bg-raw-openai.png'
  const REMOTION_COVER = 'https://cdn.railway.app/covers/remotion-rendered-with-title.png'

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockResolvedValue({ appId: '', igUserId: '', accessToken: '' })
  })

  it('§5 GATE: bg param enviado ao Satori é reelData.backgroundUrl (foto bruta), NUNCA coverResult.value (Remotion)', async () => {
    const content = JSON.stringify({
      videoUrl: 'https://example.com/video.mp4',
      backgroundUrl: RAW_OPENAI_BG,
      subtitles: [],
      hookTitle: 'SAM ALTMAN NO BANCO DOS REUS',
      highlightWords: ['OPENAI', 'SAM'],
      subtitle: 'futuro da OpenAI em jogo',
      caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
      sourceAuthor: 'testnews',
    })

    mockLimit.mockResolvedValue({ data: [{ id: 'item-§5', content }] })

    const fetchCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchCalls.push(url)
      // Railway Remotion cover render — returns a URL different from the raw background
      if (url.includes(process.env.REEL_RENDERER_URL || 'REEL_RENDERER') || url.includes('/render/remotion')) {
        return { ok: true, status: 200, json: async () => ({ url: REMOTION_COVER }) }
      }
      // Satori og/reel endpoint
      if (url.includes('/api/og/reel') || url.includes('/api/og/brand')) {
        // Capture the bg param to assert correctness
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }
      }
      // Railway brand-frame video render
      if (url.includes('/render/brand-frame')) {
        return { ok: true, status: 200, json: async () => ({ url: 'https://example.com/rendered-video.mp4' }) }
      }
      // Default
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8) }
    }))

    const { GET } = await loadRoute()
    await GET(makeCronRequest())

    // Find the Satori call
    const satoriCall = fetchCalls.find(u => u.includes('/api/og/reel') || u.includes('/api/og/brand'))

    // generateEditorialCover roda em paralelo (antes das credenciais IG) — deve sempre ser chamado
    expect(satoriCall).toBeDefined()

    const satoriUrl = new URL(satoriCall!)
    const bgParam = satoriUrl.searchParams.get('bg')

    // §5 INVIOLÁVEL: bg deve ser a foto bruta OpenAI
    expect(bgParam).toBe(RAW_OPENAI_BG)

    // §5 INVIOLÁVEL: bg NUNCA deve ser o output do Remotion (que já tem título embutido)
    expect(bgParam).not.toBe(REMOTION_COVER)
  })
})

// ── Story NÃO é publicado inline — Phase 3 A1: DB queue (stories-publisher cron) ─────────

describe('REGRESSÃO: reels-publish — story NÃO publicado inline após Phase 3 A1 (2026-06-06)', () => {
  /**
   * Phase 3 A1: story inline foi removido de reels-publish.
   * Em vez disso, story_publish_after é gravado no DB (delay 8-44min).
   * O cron stories-publisher processa a fila.
   *
   * Historico: antes da Phase 3, o story era publicado inline com poll (ids= format).
   * Bug anterior: story poll usava GET /{id}?fields=status_code → subcode 33 em tokens EAA.
   * Esse bug já não se aplica pois o story não é mais publicado em reels-publish.
   */

  const STORY_CONTENT = JSON.stringify({
    videoUrl: 'https://example.com/video.mp4',
    backgroundUrl: 'https://example.com/bg-story.png',
    subtitles: [],
    hookTitle: 'STORY TEST',
    highlightWords: ['STORY'],
    subtitle: 'story subtitle',
    caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
    sourceAuthor: 'storyauthor',
  })

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockReset()
    mockGetInstagramCredentials.mockResolvedValue({
      appId: 'app-123',
      igUserId: 'ig-user-456',
      accessToken: 'EAAtest-token',
    })
    mockLimit.mockReset()
    mockUpdate.mockClear()
    mockUpdateEq.mockClear()
  })

  it('A1: story NÃO é publicado inline — story_publish_after gravado no DB (8-44min)', async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-story', content: STORY_CONTENT, curated_content_id: null }],
    })

    const storyContainerCreations: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url)
      const body = opts?.body ? String(opts.body) : ''

      if (u.includes('/api/og/') || u.includes('/render/')) {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({ url: 'https://cover.png' }) }
      }
      // Container creation — track if STORIES container is ever requested
      if (u.includes('/media') && !u.includes('media_publish') && !u.includes('status_code') && opts?.method === 'POST') {
        if (body.includes('STORIES')) storyContainerCreations.push(u)
        return { ok: true, status: 200, json: async () => ({ id: 'ig-reel-container' }) }
      }
      if (u.includes('ids=ig-reel-container') && u.includes('status_code')) {
        return { ok: true, status: 200, json: async () => ({ 'ig-reel-container': { status_code: 'FINISHED' } }) }
      }
      if (u.includes('media_publish')) {
        return { ok: true, status: 200, json: async () => ({ id: 'ig-published' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    vi.useFakeTimers()
    const { GET } = await loadRoute()
    const routePromise = GET(makeCronRequest())
    // Story anti-shadowban delay is 45–90s (random). Advance 150s to cover max range.
    await vi.advanceTimersByTimeAsync(150_000)
    await routePromise
    vi.useRealTimers()

    // A1: story container NÃO deve ser criado em reels-publish (é deferido para stories-publisher)
    expect(storyContainerCreations).toHaveLength(0)

    // A1: mockUpdate deve ter sido chamado com story_publish_after (DB queue)
    const allUpdateCalls = mockUpdate.mock.calls as unknown[][]
    const storyQueueUpdate = allUpdateCalls.find(args => {
      const payload = args[0] as Record<string, unknown>
      return payload && typeof payload.story_publish_after === 'string'
    })
    expect(storyQueueUpdate).toBeDefined()

    // story_publish_after deve estar entre 8 e 44 min no futuro
    const payload = storyQueueUpdate![0] as Record<string, unknown>
    const publishAfter = new Date(payload.story_publish_after as string).getTime()
    const now = Date.now()
    expect(publishAfter).toBeGreaterThanOrEqual(now + 8 * 60 * 1000 - 5000) // -5s slack for fake timers
    expect(publishAfter).toBeLessThanOrEqual(now + 44 * 60 * 1000 + 5000)
  })
})

// ── Gate: brand-frame render falha → bloquear, não enviar landscape para Instagram ────────

describe('REGRESSÃO: reels-publish — brand_frame_failed bloqueia publish de vídeo landscape (migrado de capcut_render_failed 2026-06-06)', () => {
  /**
   * Brand migrou de /render/capcut → /render/brand-frame (branded frame com logo+título).
   * Comportamento: sempre renderiza (com ou sem subtítulos), falha → brand_frame_failed.
   *
   * Histórico: capcut_render_failed bloqueava apenas se subtitles.length > 0.
   * brand_frame_failed bloqueia sempre (frame é obrigatório para brand consistency).
   */

  const LANDSCAPE_CONTENT = JSON.stringify({
    videoUrl: 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/downloads/landscape.mp4',
    backgroundUrl: 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/covers/bg-landscape.png',
    subtitles: [{ text: 'BMW vai lançar elétrico compacto', startFrame: 0, endFrame: 100 }],
    hookTitle: 'BMW ELÉTRICO COMPACTO',
    highlightWords: ['BMW'],
    subtitle: 'tração traseira para todos',
    caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
    sourceAuthor: 'InsideEVs',
  })

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockReset()
    mockGetInstagramCredentials.mockResolvedValue({
      appId: 'app-123',
      igUserId: 'ig-user-123',
      accessToken: 'IGAA-token-test',
    })
    mockLimit.mockReset()
    mockUpdate.mockClear()
    mockUpdateEq.mockClear()
  })

  // Brand usa /render/brand-frame — qualquer falha bloqueia (frame obrigatório)
  it('Brand: brand-frame falha → retorna brand_frame_failed, NÃO cria container IG', async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-landscape', content: LANDSCAPE_CONTENT, curated_content_id: 'curated-landscape' }],
    })

    const igFetch = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/og/') || u.includes('/render/remotion')) {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({ url: 'https://cover.png' }) }
      }
      // brand-frame render fails
      if (u.includes('/render/brand-frame')) {
        return { ok: false, status: 500, json: async () => ({ error: 'FFmpeg crash' }) }
      }
      // Track any IG container creation calls (should NOT happen)
      if (u.includes('graph.instagram.com') || u.includes('graph.facebook.com')) {
        igFetch(u)
        return { ok: true, status: 200, json: async () => ({ id: 'ig-should-not-exist' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    const { GET } = await loadRoute()
    const res = await GET(makeBrandRequest())
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('brand_frame_failed')

    expect(igFetch).not.toHaveBeenCalled()

    const allUpdateCalls = mockUpdate.mock.calls as unknown[][]
    const failUpdate = allUpdateCalls.find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.status === 'failed' && typeof d.review_feedback === 'string' && (d.review_feedback as string).startsWith('brand_frame_failed')
    })
    expect(failUpdate).toBeDefined()
  })

  // Brand: sem subtítulos → ainda deve tentar render (frame é sempre obrigatório)
  it('Brand: SEM subtítulos → brand-frame ainda é chamado (não retorna null como capcut fazia)', async () => {
    const contentNoSubs = JSON.stringify({
      videoUrl: 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/downloads/nosubs.mp4',
      backgroundUrl: 'https://aosyonzvesotxppazugc.supabase.co/storage/v1/object/public/reels/covers/bg-nosubs.png',
      subtitles: [],  // sem legendas
      hookTitle: 'FROTA 100% ELÉTRICA',
      highlightWords: ['FROTA'],
      subtitle: 'infraestrutura EV corporativa',
      caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
      sourceAuthor: 'Brand',
    })
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-nosubs', content: contentNoSubs, curated_content_id: 'curated-nosubs' }],
    })

    const brandFrameCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/og/') || u.includes('/render/remotion')) {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({ url: 'https://cover.png' }) }
      }
      if (u.includes('/render/brand-frame')) {
        brandFrameCalls.push(u)
        return { ok: true, status: 200, json: async () => ({ url: 'https://railway.app/brand-frame/rendered.mp4' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    // Credenciais ausentes — vai falhar em IG mas o brand-frame já terá sido chamado
    mockGetInstagramCredentials.mockResolvedValue({ appId: '', igUserId: '', accessToken: '' })

    const { GET } = await loadRoute()
    await GET(makeBrandRequest())

    // brand-frame DEVE ter sido chamado mesmo sem subtítulos
    expect(brandFrameCalls.length).toBeGreaterThan(0)
  })

  // AI & Tech usa /render/doomguy-frame — qualquer falha bloqueia (formato da fonte desconhecido)
  it('AI&Tech: doomguy-frame falha → retorna doomguy_frame_failed, NÃO cria container IG', async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-doomguy', content: LANDSCAPE_CONTENT, curated_content_id: 'curated-doomguy' }],
    })

    const igFetch = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/og/') || u.includes('/render/remotion')) {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({ url: 'https://cover.png' }) }
      }
      // doomguy-frame render fails
      if (u.includes('/render/doomguy-frame')) {
        return { ok: false, status: 500, json: async () => ({ error: 'FFmpeg crash' }) }
      }
      // Track any IG container creation calls (should NOT happen)
      if (u.includes('graph.instagram.com') || u.includes('graph.facebook.com')) {
        igFetch(u)
        return { ok: true, status: 200, json: async () => ({ id: 'ig-should-not-exist' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    const { GET } = await loadRoute()
    const res = await GET(makeCronRequest()) // AI & Tech workspace (default)
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('doomguy_frame_failed')

    expect(igFetch).not.toHaveBeenCalled()

    const allUpdateCalls = mockUpdate.mock.calls as unknown[][]
    const failUpdate = allUpdateCalls.find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.status === 'failed' && typeof d.review_feedback === 'string' && (d.review_feedback as string).startsWith('doomguy_frame_failed')
    })
    expect(failUpdate).toBeDefined()
  })
})

// ── Anti-shadowban fixes 1 & 2 — hashtag comment + alt_text (2026-06-06) ─────────────────

describe('REGRESSÃO: anti-shadowban fixes 1 & 2 — hashtag no comentário e alt_text (2026-06-06)', () => {
  /**
   * Fix 1: hashtags NÃO ficam na caption (sinal óbvio de automação).
   *   - captionClean strip: /#[\w\u00C0-\u017E]+/g
   *   - Após publish, faz POST /{postId}/comments com as hashtags como primeiro comentário.
   *
   * Fix 2: alt_text = hookTitle no container REELS.
   *   - Ausência de alt_text é sinal de automação descuidada; IG usa para ranking de acessibilidade.
   */

  const HOOK_TITLE = 'FROTA 100% ELÉTRICA'
  const CAPTION_WITH_HASHTAGS =
    'Caption com mais de 100 caracteres para passar no quality gate do reels-publish. ' +
    'Mobilidade elétrica corporativa no Brasil. #eletroposto #EVBrasil #mobilidadeeletrica #brand #frota'
  const CAPTION_WITHOUT_HASHTAGS =
    'Caption com mais de 100 caracteres para passar no quality gate do reels-publish. ' +
    'Mobilidade elétrica corporativa no Brasil. Sem hashtags neste texto puro para o teste.'

  const makebrandContent = (caption: string) =>
    JSON.stringify({
      videoUrl: 'https://example.com/video.mp4',
      backgroundUrl: 'https://example.com/bg.png',
      subtitles: [],
      hookTitle: HOOK_TITLE,
      highlightWords: ['FROTA'],
      subtitle: 'infraestrutura EV corporativa',
      caption,
      sourceAuthor: 'Brand',
    })

  function makebrandFetch(
    onContainerReels?: (body: Record<string, unknown>) => void,
    onComment?: (params: Record<string, string>) => void,
    commentResponse?: { ok: boolean; status: number; json: () => Promise<unknown> },
  ) {
    return vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url)
      const body = opts?.body ? (JSON.parse(String(opts.body)) as Record<string, unknown>) : null

      if (u.includes('/api/og/') || u.includes('/render/')) {
        return {
          ok: true, status: 200,
          arrayBuffer: async () => new ArrayBuffer(8),
          json: async () => ({ url: 'https://example.com/rendered.mp4' }),
        }
      }
      if (u.includes('/comments') && opts?.method === 'POST') {
        // New code sends hashtags as URL query params, not JSON body
        const urlObj = new URL(u)
        const params: Record<string, string> = {}
        urlObj.searchParams.forEach((v, k) => { params[k] = v })
        if (onComment) onComment(params)
        return commentResponse ?? { ok: true, status: 200, json: async () => ({ id: 'comment-ok' }) }
      }
      if (u.includes('/media') && !u.includes('media_publish') && !u.includes('status_code') && opts?.method === 'POST') {
        if (body?.media_type === 'REELS' && onContainerReels) onContainerReels(body)
        if (body?.media_type === 'REELS') return { ok: true, status: 200, json: async () => ({ id: 'ig-reel-container' }) }
        if (body?.media_type === 'STORIES') return { ok: true, status: 200, json: async () => ({ id: 'ig-story-container' }) }
        return { ok: true, status: 200, json: async () => ({ id: 'ig-container' }) }
      }
      if (u.includes('ids=ig-reel-container') && u.includes('status_code')) {
        return { ok: true, status: 200, json: async () => ({ 'ig-reel-container': { status_code: 'FINISHED' } }) }
      }
      if (u.includes('ids=ig-story-container') && u.includes('status_code')) {
        return { ok: true, status: 200, json: async () => ({ 'ig-story-container': { status_code: 'FINISHED' } }) }
      }
      if (u.includes('media_publish')) {
        return { ok: true, status: 200, json: async () => ({ id: 'ig-post-published' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  }

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockReset()
    mockGetInstagramCredentials.mockResolvedValue({
      appId: 'app-123',
      igUserId: 'ig-user-brand',
      accessToken: 'ig-token-brand',
    })
    mockLimit.mockReset()
    mockUpdate.mockClear()
    mockUpdateEq.mockClear()
    vi.useRealTimers() // ensure clean timer state if previous test timed out without cleanup
  })

  it('Fix 1 — caption publicada NÃO contém # E /{postId}/comments foi chamado com as hashtags', async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-fix1', content: makebrandContent(CAPTION_WITH_HASHTAGS), curated_content_id: null }],
    })

    let capturedReelBody: Record<string, unknown> | null = null
    const capturedCommentBodies: Record<string, unknown>[] = []

    vi.stubGlobal('fetch', makebrandFetch(
      (body) => { capturedReelBody = body },
      (body) => { capturedCommentBodies.push(body) },
    ))

    // Force Math.random() to 0.5 so B2 12% omission path is never taken (requires >= 0.12)
    const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    vi.useFakeTimers()
    const { GET } = await loadRoute()
    const routePromise = GET(makeBrandRequest())
    await vi.advanceTimersByTimeAsync(130_000) // covers poll (5s) + story delay (up to 90s) + story poll (5s)
    await routePromise
    vi.useRealTimers()
    mathRandomSpy.mockRestore()

    // caption publicada não contém hashtags
    expect(capturedReelBody).not.toBeNull()
    expect(String(capturedReelBody!.caption)).not.toMatch(/#/)

    // comentário postado com as hashtags
    expect(capturedCommentBodies.length).toBeGreaterThan(0)
    const commentMessage = String(capturedCommentBodies[0].message)
    expect(commentMessage).toMatch(/#eletroposto/)
    expect(commentMessage).toMatch(/#EVBrasil/)
    expect(commentMessage).toMatch(/#brand/)
  }, 30_000)

  it('Fix 1 — caption sem hashtags → comentário NÃO é postado', async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-fix1-clean', content: makebrandContent(CAPTION_WITHOUT_HASHTAGS), curated_content_id: null }],
    })

    const commentCalls: string[] = []

    vi.stubGlobal('fetch', makebrandFetch(
      undefined,
      (body) => { commentCalls.push(String(body.message)) },
    ))

    vi.useFakeTimers()
    const { GET } = await loadRoute()
    const routePromise = GET(makeBrandRequest())
    await vi.advanceTimersByTimeAsync(130_000)
    await routePromise
    vi.useRealTimers()

    // nenhum comentário de hashtags deve ser postado
    expect(commentCalls).toHaveLength(0)
  }, 30_000)

  it('Fix 1 — falha silenciosa (bug 2026-06-07): quando /comments retorna erro, rota ainda ok=true e console.error registrado', async () => {
    /**
     * Bug: fetch não lança exceção em HTTP 4xx/5xx. O try-catch não disparava.
     * O console.log de "Hashtag comment posted" rodava mesmo quando a API retornava erro.
     * Fix: verificar commentRes.ok e logar console.error se falhar.
     * Este teste garante que a rota retorna ok=true (best-effort) mas loga o erro.
     */
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-fix1-err', content: makebrandContent(CAPTION_WITH_HASHTAGS), curated_content_id: null }],
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Força Math.random() a 0.5 para que o caminho do comentário de hashtag SEMPRE
    // rode (gate >= 0.12). Sem isto, ~12% das execuções pulavam o comentário e o
    // teste falhava de forma intermitente (flaky) — bloqueando o pre-push à toa.
    const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    vi.stubGlobal('fetch', makebrandFetch(
      undefined,
      undefined,
      { ok: false, status: 400, json: async () => ({ error: { message: 'Test API error', code: 400 } }) },
    ))

    vi.useFakeTimers()
    const { GET } = await loadRoute()
    const routePromise = GET(makeBrandRequest())
    await vi.advanceTimersByTimeAsync(130_000)
    const res = await routePromise
    vi.useRealTimers()

    const data = await res.json() as { ok: boolean }
    // rota ainda retorna ok=true (comentário é best-effort, não bloqueia publicação)
    expect(data.ok).toBe(true)
    // erro do comentário deve ser logado
    const errorCalls = consoleSpy.mock.calls.map(c => String(c[0]))
    expect(errorCalls.some(m => m.includes('Hashtag comment FAILED'))).toBe(true)

    consoleSpy.mockRestore()
    mathRandomSpy.mockRestore()
  }, 30_000)

  it('Fix 2 — containerBody NÃO contém alt_text (campo rejeitado pelo IG API #100 para REELS)', async () => {
    /**
     * Instagram API retorna (#100) The param alt_text is not supported for REEL.
     * alt_text foi removido do containerBody para evitar falha de container creation.
     * Este teste garante que o campo não seja reintroduzido inadvertidamente.
     */
    mockLimit.mockResolvedValue({
      data: [{ id: 'item-fix2', content: makebrandContent(CAPTION_WITH_HASHTAGS), curated_content_id: null }],
    })

    let capturedReelBody: Record<string, unknown> | null = null

    vi.stubGlobal('fetch', makebrandFetch(
      (body) => { capturedReelBody = body },
    ))

    vi.useFakeTimers()
    const { GET } = await loadRoute()
    const routePromise = GET(makeBrandRequest())
    await vi.advanceTimersByTimeAsync(130_000)
    await routePromise
    vi.useRealTimers()

    expect(capturedReelBody).not.toBeNull()
    // alt_text MUST NOT be present — IG API rejects it for REELS with error #100
    expect(capturedReelBody!.alt_text).toBeUndefined()
  }, 30_000)
})

// ── Anti-shadowban fix 3 — throttle CTA "comenta" em buildbrandAiPrompt (2026-06-06) ──────

describe('REGRESSÃO: anti-shadowban Fix 3 — buildbrandAiPrompt throttle CTA "comenta" (2026-06-06)', () => {
  /**
   * Fix 3: CTA "comenta X" é limitado a ≤2x por semana.
   * reels-prepare-brand/route.ts conta posts com "comenta" nos últimos 7 dias via DB,
   * passa comentaCTACount para buildbrandAiPrompt em _shared.ts.
   * Quando count >= 2, o prompt proíbe o CTA.
   */

  it('Fix 3 throttle ativo — comentaCTACount=2 → prompt contém "PROIBIDO"', async () => {
    const { buildbrandAiPrompt } = await import('../reels-prepare-brand/_shared')
    const prompt = buildbrandAiPrompt({
      srtText: '',
      instagramHandle: '@brand',
      sourceContent: 'EV fleet electrification in Brazil',
      fullText: 'Electric vehicles for corporate fleets',
      comentaCTACount: 2,
    })
    expect(prompt).toContain('PROIBIDO')
  })

  it('Fix 3 throttle inativo — comentaCTACount=0 → prompt NÃO contém "PROIBIDO"', async () => {
    const { buildbrandAiPrompt } = await import('../reels-prepare-brand/_shared')
    const prompt = buildbrandAiPrompt({
      srtText: '',
      instagramHandle: '@brand',
      sourceContent: 'EV fleet electrification in Brazil',
      fullText: 'Electric vehicles for corporate fleets',
      comentaCTACount: 0,
    })
    expect(prompt).not.toContain('PROIBIDO')
  })
})

// ── Estilo editorial @ato: highlight no texto queimado (2026-07-12) ──────────

describe('REGRESSÃO: reels-publish — payload do doomguy-frame inclui highlightClause/highlightWords (estilo @ato, 2026-07-12)', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    process.env.REEL_RENDERER_URL = 'https://renderer.test'
    mockGetInstagramCredentials.mockResolvedValue({ appId: '', igUserId: '', accessToken: '' })
  })

  it('envia highlightClause e highlightWords ao /render/doomguy-frame para o destaque em vermelho', async () => {
    const content = JSON.stringify({
      videoUrl: 'https://example.com/video.mp4',
      backgroundUrl: 'https://example.com/bg.png',
      subtitles: [],
      hookTitle: 'A ANTHROPIC VIU 8X MAIS CÓDIGO POR ENGENHEIRO USANDO SUA PRÓPRIA IA',
      highlightWords: ['ANTHROPIC'],
      highlightClause: '8X MAIS CÓDIGO',
      subtitle: 'produtividade com IA',
      caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
      sourceAuthor: 'testnews',
    })

    mockLimit.mockResolvedValue({ data: [{ id: 'item-ato-style', content }] })

    const bodies: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      bodies.push({ url: String(url), body: init?.body ?? '' })
      if (String(url).includes('/validate-layout')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, errors: [], warnings: [] }) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({ url: 'https://example.com/rendered.mp4' }),
        arrayBuffer: async () => new ArrayBuffer(8),
      }
    }))

    const { GET } = await loadRoute()
    await GET(makeCronRequest())

    const frameCall = bodies.find(b => b.url.includes('/render/doomguy-frame'))
    expect(frameCall).toBeDefined()

    const payload = JSON.parse(frameCall!.body)
    // INVIOLÁVEL: o destaque da cláusula-chave (estilo @ato) depende destes campos
    expect(payload.highlightClause).toBe('8X MAIS CÓDIGO')
    expect(payload.highlightWords).toEqual(['ANTHROPIC'])
    expect(payload.hookTitle).toBe('A ANTHROPIC VIU 8X MAIS CÓDIGO POR ENGENHEIRO USANDO SUA PRÓPRIA IA')
  })

  it('reel antigo na fila (sem highlightClause) não quebra — envia string vazia', async () => {
    mockLimit.mockResolvedValue({ data: [{ id: 'item-legacy', content: SAMPLE_REEL_CONTENT }] })

    const bodies: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      bodies.push({ url: String(url), body: init?.body ?? '' })
      if (String(url).includes('/validate-layout')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, errors: [], warnings: [] }) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({ url: 'https://example.com/rendered.mp4' }),
        arrayBuffer: async () => new ArrayBuffer(8),
      }
    }))

    const { GET } = await loadRoute()
    await GET(makeCronRequest())

    const frameCall = bodies.find(b => b.url.includes('/render/doomguy-frame'))
    expect(frameCall).toBeDefined()
    const payload = JSON.parse(frameCall!.body)
    expect(payload.highlightClause).toBe('')
    expect(Array.isArray(payload.highlightWords)).toBe(true)
  })
})

// ── Item malformado (sem caption/subtitles) trava o cron inteiro (bug 2026-07-12) ──────────

describe('REGRESSÃO: reels-publish rejeita item sem caption/subtitles sem crashar (bug 2026-07-12)', () => {
  /**
   * Bug: um item `reel_ready` sem o campo `caption` no JSON de conteúdo fazia
   * `reelData.caption.length` (quality gate) lançar TypeError não capturado. O handler
   * morria com 500 antes de marcar o item como `failed`. Como a fila é FIFO por
   * `created_at`, esse item continuava sendo re-selecionado a cada execução do cron e
   * travava permanentemente os itens válidos atrás dele — @ai_br_videos ficou 48.7h sem
   * publicar como resultado direto disso.
   *
   * Fix: gate explícito logo após o parse do JSON, validando que `caption` é string e
   * `subtitles` é array antes de qualquer acesso a `.length`.
   */

  const MISSING_CAPTION_CONTENT = JSON.stringify({
    videoUrl: 'https://example.com/video.mp4',
    backgroundUrl: 'https://example.com/bg.png',
    subtitles: [],
    hookTitle: 'Sem Caption',
    highlightWords: [],
    sourceAuthor: 'testauthor',
  })

  const MISSING_SUBTITLES_CONTENT = JSON.stringify({
    videoUrl: 'https://example.com/video.mp4',
    backgroundUrl: 'https://example.com/bg.png',
    hookTitle: 'Sem Subtitles',
    highlightWords: [],
    caption: 'Caption com mais de 100 caracteres para passar no quality gate do reels-publish route no Social Machine V3.',
    sourceAuthor: 'testauthor',
  })

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
    mockGetInstagramCredentials.mockReset()
    mockGetInstagramCredentials.mockResolvedValue({ appId: '', igUserId: '', accessToken: '' })
    mockLimit.mockReset()
    mockUpdate.mockClear()
    mockUpdateEq.mockClear()
  })

  it('item sem campo `caption` → marcado failed com missing_required_fields, sem lançar exceção', async () => {
    mockLimit.mockResolvedValue({ data: [{ id: 'item-missing-caption', content: MISSING_CAPTION_CONTENT }] })

    const { GET } = await loadRoute()
    const res = await GET(makeCronRequest())
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('Missing required fields — rejected')

    const failUpdate = (mockUpdate.mock.calls as unknown[][]).find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.status === 'failed' && typeof d.review_feedback === 'string' && (d.review_feedback as string).includes('missing_required_fields')
    })
    expect(failUpdate).toBeDefined()
  })

  it('item sem `subtitles` (campo ausente) → marcado failed com missing_required_fields, sem lançar exceção', async () => {
    mockLimit.mockResolvedValue({ data: [{ id: 'item-missing-subtitles', content: MISSING_SUBTITLES_CONTENT }] })

    const { GET } = await loadRoute()
    const res = await GET(makeCronRequest())
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('Missing required fields — rejected')

    const failUpdate = (mockUpdate.mock.calls as unknown[][]).find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.status === 'failed' && typeof d.review_feedback === 'string' && (d.review_feedback as string).includes('missing_required_fields')
    })
    expect(failUpdate).toBeDefined()
  })

  it('caption presente mas curta (<100 chars) → cai no gate de qualidade pré-existente, não no novo gate', async () => {
    const shortCaptionContent = JSON.stringify({
      videoUrl: 'https://example.com/video.mp4',
      backgroundUrl: 'https://example.com/bg.png',
      subtitles: [],
      hookTitle: 'Caption curta',
      highlightWords: [],
      caption: 'muito curta',
      sourceAuthor: 'testauthor',
    })
    mockLimit.mockResolvedValue({ data: [{ id: 'item-short-caption', content: shortCaptionContent }] })

    const { GET } = await loadRoute()
    const res = await GET(makeCronRequest())
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('Caption too short — rejected')

    const failUpdate = (mockUpdate.mock.calls as unknown[][]).find((args) => {
      const d = args[0] as Record<string, unknown>
      return d.review_feedback === 'Caption too short (<100 chars)'
    })
    expect(failUpdate).toBeDefined()
  })
})

/**
 * REGRESSÃO: JSON inválido no content deve marcar failed COM review_feedback
 *
 * Bug: quando item.content tem JSON inválido, o catch na linha ~140 marcava status='failed'
 * mas não definia review_feedback. Isso deixava 16+ itens em failed sem mensagem de erro
 * visível no banco, impossibilitando diagnosticar a causa raiz.
 *
 * Garantia: se JSON.parse(item.content) falhar, o update DEVE incluir review_feedback
 * descrevendo o problema.
 */
describe('REGRESSÃO: JSON inválido → failed com review_feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_BASE_URL = 'http://localhost:3000'
  })

  it('marca failed COM review_feedback quando content não é JSON válido', async () => {
    // Item com content inválido (não é JSON)
    mockLimit.mockResolvedValueOnce({
      data: [
        {
          id: 'invalid-json-item',
          workspace_id: 'test-workspace',
          format: 'reel',
          platform: 'instagram',
          status: 'reel_ready',
          content: 'isto não é um JSON válido {[', // JSON malformado
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    })

    mockGetInstagramCredentials.mockResolvedValueOnce({
      appId: '',
      igUserId: '123',
      accessToken: 'token',
    })

    const { GET } = await loadRoute()
    const req = makeCronRequest()

    await GET(req)

    // Deve ter chamado update com status='failed' E review_feedback
    const updateCalls = mockUpdate.mock.calls
    const failedUpdateCall = updateCalls.find((call: any[]) =>
      call[0]?.status === 'failed'
    )

    expect(failedUpdateCall).toBeDefined()
    expect(failedUpdateCall[0]).toHaveProperty('review_feedback')
    expect(failedUpdateCall[0].review_feedback).toContain('JSON')
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'invalid-json-item')
  })
})
