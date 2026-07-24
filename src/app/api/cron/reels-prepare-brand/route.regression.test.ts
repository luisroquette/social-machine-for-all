/**
 * REGRESSÃO: reels-prepare-brand deadlock pipeline (bug 2026-05-20)
 *
 * Dois bugs encadeados que causaram zero posts brandmob por dias:
 *
 * Bug 1 — Gate violation: items eram inseridos como `reel_ready` mesmo sem
 *   backgroundUrl quando o OpenAI falhava. O gate no reels-publish bloqueava
 *   esses itens, marcando como `failed`. Resultado: sem posts.
 *
 * Bug 2 — Dedup cega: o check `.eq('curated_content_id', v.id).eq('target_format','reel')`
 *   contava também itens com status='failed'. Depois de um item ir para `failed`,
 *   o mesmo curated_content_id nunca mais era processado → deadlock permanente.
 *
 * Fixes:
 *   1. Gate: `if (!backgroundUrl) { continue }` antes do insert
 *   2. Dedup: `.not('status','eq','failed')` para permitir retry de itens falhos
 *
 * Bug 3 — Dedup trata `rejected` como bloqueio (bug 2026-05-20):
 *   O check de dedup excluía apenas `failed`, mas não `rejected`. Um item marcado como
 *   `rejected` bloqueava o mesmo curated_content_id para sempre → mesmo deadlock.
 *
 * Fix 3: `.not('status','in','("failed","rejected")')` — rejected é tratado igual a failed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __testdir = path.dirname(fileURLToPath(import.meta.url))

// ── Auth mock ────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: vi.fn().mockReturnValue(true),
}))

// ── Settings mock ─────────────────────────────────────────────────────────────

vi.mock('@/lib/settings/load-settings', () => ({
  getVariable: vi.fn().mockResolvedValue('@brand'),
  getNumericVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
    const defaults: Record<string, number> = {
      reel_min_relevance_score: 20,
      reel_lookback_hours: 48,
      reel_candidate_limit: 20,
      reel_prep_max_tokens: 1500,
    }
    return Promise.resolve(defaults[key] ?? null)
  }),
}))

// ── Sentry mock ───────────────────────────────────────────────────────────────

const mockSentryMessage = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => mockSentryMessage(...args),
  captureException: vi.fn(),
}))

// ── generateStoredImage mock — configurable per test ─────────────────────────

const mockGenerateStoredImage = vi.fn()
vi.mock('@/lib/ai/openai-image', () => ({
  generateStoredImage: (...args: unknown[]) => mockGenerateStoredImage(...args),
}))

// ── generate-with-fallback mock ───────────────────────────────────────────────
const mockGenerateTextWithFallback = vi.fn()
vi.mock('@/lib/ai/generate-with-fallback', () => ({
  generateTextWithFallback: (...args: unknown[]) => mockGenerateTextWithFallback(...args),
  aiSentinelCode: vi.fn().mockReturnValue('ai_error'),
  AI_SENTINEL: { RATE_LIMITED: 'ai_rate_limited', UNAVAILABLE: 'ai_unavailable' },
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const capturedInserts: unknown[] = []

function makeSupabaseMock({
  candidateCount = 1,
  existingReadyCount = 0,
  existingReel = null as { count: number } | null,
} = {}) {
  const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

  const mockInsert = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c })
  const mockUpload = vi.fn().mockResolvedValue({ error: null })
  const mockGetPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = vi.fn((table: string): any => {
    if (table === 'curated_content') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: candidateCount > 0 ? [{
            id: 'content-1',
            source_url: 'https://x.com/user/status/123',
            source_content: 'BYD lança novo modelo EV com bateria de 1000km de autonomia no Brasil em 2026 para frotas corporativas',
            source_author: 'evnews',
            relevance_score: 85,
            source_metrics: { media_types: ['video'], video_url: 'https://cdn.example.com/video.mp4' },
          }] : [],
        }),
        update: mockUpdate,
      }
    }

    if (table === 'generated_content') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        // head query (count) — returns based on scenario
        head: vi.fn().mockResolvedValue(
          existingReel !== null ? existingReel : { count: existingReadyCount }
        ),
        insert: vi.fn((data: unknown) => {
          capturedInserts.push(data)
          return { error: null }
        }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: existingReadyCount > 0 ? [{ id: 'ready-1' }] : [],
          count: existingReadyCount,
        }),
      }
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      head: vi.fn().mockResolvedValue({ count: 0 }),
      insert: mockInsert,
      update: mockUpdate,
    }
  })

  const storage = {
    from: vi.fn(() => ({
      upload: mockUpload,
      getPublicUrl: mockGetPublicUrl,
    })),
  }

  return { from, mockInsert, storage, WORKSPACE_ID }
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

// ── Fetch mock (Railway warmup + video download + Anthropic) ─────────────────

function mockFetchForPrepare({ railwayOk = true, anthropicOk = true, transcribeOk = true, transcribeMalformed = false } = {}) {
  let callCount = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    callCount++
    // Railway health check
    if (url.includes('/health')) return { ok: railwayOk, json: async () => ({ ok: true }) }
    // Video download — headers required for Content-Length guard (§6)
    if (url.includes('cdn.example.com/video.mp4')) {
      return {
        ok: true,
        headers: { get: (_h: string) => null }, // Content-Length ausente → 0 → guard não dispara
        arrayBuffer: async () => new ArrayBuffer(1024),
      }
    }
    // Railway transcribe — default: sucesso, sem fala real detectada (sem SRT a traduzir)
    if (url.includes('/transcribe')) {
      if (!transcribeOk) return { ok: false }
      if (transcribeMalformed) return { ok: true, text: async () => '<html>502 Bad Gateway</html>' }
      return { ok: true, text: async () => JSON.stringify({ srt: '', text: '' }) }
    }
    // Anthropic API
    if (url.includes('anthropic.com')) {
      if (!anthropicOk) return { ok: false, status: 500 }
      return {
        ok: true,
        json: async () => ({
          content: [{
            text: JSON.stringify({
              srt_ptbr: '',
              hookTitle: 'BYD LANÇA EV COM 1000KM DE AUTONOMIA NO BRASIL',
              highlightWords: ['BYD', '1000KM'],
              subtitle: 'frotas corporativas EV',
              imagePrompt: 'Electric BYD SUV low angle hero shot dark studio violet blue rim lighting',
              caption: 'BYD acaba de anunciar um modelo elétrico revolucionário para o mercado brasileiro de frotas corporativas. Com autonomia de 1000km, este EV muda completamente o cenário de mobilidade elétrica no país. Empresas que operam frotas poderão reduzir custos operacionais em até 40%. Salva esse post para não perder. #EV #EVBrasil #brand',
            }),
          }],
        }),
      }
    }
    return { ok: false }
  }))
  return () => callCount
}

// Mock dedicado com UM candidato do X: a query 'x' (1ª chamada a .select()) retorna
// o candidato; a query 'youtube' (2ª chamada) retorna vazio — reflete a produção,
// onde as duas queries são disjuntas por source_platform (makeSupabaseMock
// compartilhado devolve a mesma linha pras duas, o que só importa quando o item
// falha ANTES do usedIds.add — daí o dedup de sucesso não entra em ação). O
// contador conta chamadas a .select() especificamente — o reset de sentinelas no
// início da rota também chama from('curated_content'), mas via .update(), então
// não deve consumir o contador.
function makeSingleXCandidateMock() {
  let selectCallCount = 0
  const insertSpy = vi.fn().mockResolvedValue({ error: null })
  const fromMock = vi.fn((table: string) => {
    if (table === 'curated_content') {
      return {
        select: vi.fn(() => {
          selectCallCount++
          const data = selectCallCount === 1 ? [{
            id: 'content-1',
            source_url: 'https://x.com/user/status/123',
            source_content: 'BYD lança novo modelo EV com bateria de 1000km de autonomia no Brasil em 2026 para frotas corporativas',
            source_author: 'evnews',
            relevance_score: 85,
            source_metrics: { media_types: ['video'], video_url: 'https://cdn.example.com/video.mp4' },
          }] : []
          return {
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data }),
          }
        }),
        update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
      }
    }
    if (table === 'generated_content') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        head: vi.fn().mockResolvedValue({ count: 0 }),
        insert: insertSpy,
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(), head: vi.fn().mockResolvedValue({ count: 0 }), insert: vi.fn().mockResolvedValue({ error: null }) }
  })
  const storage = { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }) })) }
  return { fromMock, storage, insertSpy }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: reels-prepare-brand — gate sem backgroundUrl (bug 2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedInserts.length = 0
    // Default: AI returns valid JSON for all tests (override per-test when needed)
    mockGenerateTextWithFallback.mockResolvedValue(
      '{"srt_ptbr":"","hookTitle":"EV TITULO TESTE","highlightWords":["EV"],"subtitle":"teste EV","imagePrompt":"electric vehicle dark studio","caption":"Caption de teste para EV."}'
    )
  })

  it('GATE: NÃO insere item como reel_ready quando OpenAI falha (sem backgroundUrl)', async () => {
    // OpenAI falha → backgroundUrl nunca é setado
    mockGenerateStoredImage.mockRejectedValue(new Error('OpenAI billing limit exceeded'))
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { from, storage } = makeSupabaseMock({ candidateCount: 1, existingReadyCount: 0 })
    // Override generated_content insert to track calls
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from, storage } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // Route deve retornar ok (sem crash)
    expect(body.ok).toBe(true)
    // Nenhum item deve ter sido inserido na fila
    expect(body.prepared).toBe(0)

    // Sentry deve ter sido chamado com level: 'error', não 'warning'
    expect(mockSentryMessage).toHaveBeenCalledWith(
      expect.stringContaining('OpenAI background failed'),
      expect.objectContaining({ level: 'error' })
    )
  })

  it('GUARDRAIL BRASIL: não prepara reel estrangeiro sem contexto Brasil', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/bg.png')
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { from, storage } = makeSupabaseMock({ candidateCount: 1, existingReadyCount: 0 })

    const foreignFrom = vi.fn((table: string) => {
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          contains: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'foreign-1',
              source_url: 'https://x.com/user/status/999',
              source_content: 'Electric Car Earthing Wire Needed at Home? In this video charging Hyundai EV directly from a normal home socket.',
              source_author: 'foreign',
              relevance_score: 85,
              source_platform: 'x',
              source_metrics: { media_types: ['video'], video_url: 'https://cdn.example.com/video.mp4' },
            }],
          }),
          update: vi.fn(() => {
            const chain: Record<string, unknown> = {}
            chain.eq = vi.fn(() => chain)
            chain.in = vi.fn(() => chain)
            chain.lt = vi.fn().mockResolvedValue({ error: null })
            return chain
          }),
        }
      }
      return from(table)
    })

    vi.mocked(getAdminClient).mockReturnValue({ from: foreignFrom, storage } as never)

    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/reels-prepare-brand') as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.skipped).toBe('no_ev_video')
    expect(capturedInserts).toHaveLength(0)
  })

  it('GATE: insere normalmente quando backgroundUrl é gerado com sucesso', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { from, storage } = makeSupabaseMock({ candidateCount: 1, existingReadyCount: 0 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from, storage } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.prepared).toBe(1)
  })
})

describe('REGRESSÃO: reels-prepare-brand — dedup não bloqueia retry de failed (bug 2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedInserts.length = 0
    mockGenerateTextWithFallback.mockResolvedValue(
      '{"srt_ptbr":"","hookTitle":"EV TITULO TESTE","highlightWords":["EV"],"subtitle":"teste EV","imagePrompt":"electric vehicle dark studio","caption":"Caption de teste para EV."}'
    )
  })

  it('DEDUP: items com status=failed são retentados (not().eq("status","failed") no count)', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')

    // Simula cenário: content-1 já tem um generated_content record mas com status='failed'
    // O count query (com .not('status','eq','failed')) DEVE retornar 0 → item é reprocessado
    const notSpy = vi.fn().mockReturnThis()
    const headSpy = vi.fn().mockResolvedValue({ count: 0 }) // 0 não-failed records

    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: notSpy,
          head: headSpy,
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          contains: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-1',
              source_url: 'https://x.com/user/status/123',
              source_content: 'BYD lança EV com 1000km para frotas corporativas no Brasil 2026',
              source_author: 'evnews',
              relevance_score: 85,
              source_metrics: { media_types: ['video'], video_url: 'https://cdn.example.com/video.mp4' },
            }],
          }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        head: vi.fn().mockResolvedValue({ count: 0 }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock, storage: { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }) })) } } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // DEVE ter chamado .not('status', 'in', '("failed","rejected")') no dedup check
    expect(notSpy).toHaveBeenCalledWith('status', 'in', '("failed","rejected")')

    // Item deve ter sido processado (não bloqueado pelo dedup)
    expect(body.prepared).toBe(1)
  })
})

describe('REGRESSÃO: dedup não bloqueia retry de rejected (bug 2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedInserts.length = 0
    mockGenerateTextWithFallback.mockResolvedValue(
      '{"srt_ptbr":"","hookTitle":"EV TITULO TESTE","highlightWords":["EV"],"subtitle":"teste EV","imagePrompt":"electric vehicle dark studio","caption":"Caption de teste para EV."}'
    )
  })

  it('DEDUP: items com status=rejected são retentados (não bloqueados pelo dedup)', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')

    // Cenário: content-1 tem um generated_content com status='rejected'
    // O dedup deve ignorá-lo (tratar igual a 'failed') → count retorna 0 → item é reprocessado
    const notSpy = vi.fn().mockReturnThis()
    const headSpy = vi.fn().mockResolvedValue({ count: 0 }) // rejected não conta como bloqueio

    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: notSpy,
          head: headSpy,
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          contains: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-rejected',
              source_url: 'https://x.com/user/status/456',
              source_content: 'Tesla lança Model 3 no Brasil por R$250k com autonomia de 600km bateria nova geração frota elétrica corporativa',
              source_author: 'sawyermerritt',
              relevance_score: 90,
              source_metrics: { media_types: ['video'], video_url: 'https://cdn.example.com/video.mp4' },
            }],
          }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        head: vi.fn().mockResolvedValue({ count: 0 }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock, storage: { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }) })) } } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // O dedup DEVE usar .not('status', 'in', '("failed","rejected")') — rejected é tratado igual a failed
    expect(notSpy).toHaveBeenCalledWith('status', 'in', '("failed","rejected")')

    // Item deve ter sido processado (não bloqueado pelo rejected anterior)
    expect(body.prepared).toBe(1)
  })

  it('DEDUP: items com status=approved ainda são bloqueados pelo dedup', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')

    // Cenário: content-1 já tem um generated_content com status='approved'
    // O dedup termina em .not(...) — precisa resolver com { count: 1 } para bloquear o item
    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        // existingReady query termina em .eq('status','reel_ready') → mockReturnThis → count=undefined → 0 (sem queue_full)
        // dedup query termina em .not('status','in',...) → mockResolvedValue({count:1}) → item bloqueado
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ count: 1, data: null, error: null }),
          head: vi.fn().mockResolvedValue({ count: 0 }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          contains: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-approved',
              source_url: 'https://x.com/user/status/789',
              source_content: 'Tesla lança Model 3 no Brasil por R$250k com autonomia de 600km bateria nova geração frota elétrica corporativa',
              source_author: 'evbrasil',
              relevance_score: 80,
              source_metrics: { media_types: ['video'], video_url: 'https://cdn.example.com/video.mp4' },
            }],
          }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        head: vi.fn().mockResolvedValue({ count: 0 }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock, storage: { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }) })) } } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // Item com status=approved deve ser bloqueado (prepared=0)
    expect(body.prepared).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: reel Telangana/Índia publicado com áudio+texto em inglês (bug 2026-07-06)
// Timeout de transcrição de 15s garantia falha (Railway leva ~60s em vídeos do X).
// A falha era engolida em silêncio e o vídeo original (inglês) ia ao ar sem legenda.
// Fix: timeout 90s + gate — se a transcrição falhar, o item é pulado (não publicado
// com idioma desconhecido), não mais "proceed without SRT".
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: transcrição do X é obrigatória — sem ela, item é pulado (bug Telangana 2026-07-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedInserts.length = 0
    mockGenerateTextWithFallback.mockResolvedValue(
      '{"srt_ptbr":"","hookTitle":"EV TITULO TESTE","highlightWords":["EV"],"subtitle":"teste EV","imagePrompt":"electric vehicle dark studio","caption":"Caption de teste para EV."}'
    )
  })

  it('timeout de transcrição do X é 90s, não 15s', () => {
    const src = fs.readFileSync(path.resolve(__testdir, './route.ts'), 'utf-8')
    const transcribeBlock = src.slice(src.indexOf('X Twitter: download'), src.indexOf('X Twitter: download') + 1500)
    expect(transcribeBlock).toContain('AbortSignal.timeout(90_000)')
    expect(transcribeBlock).not.toContain('AbortSignal.timeout(15_000)')
  })

  it('quando a transcrição falha (rede/timeout), o item é PULADO — não publicado com áudio de idioma desconhecido', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    mockFetchForPrepare({ transcribeOk: false })

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { fromMock, storage, insertSpy } = makeSingleXCandidateMock()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock, storage } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.prepared).toBe(0)
    expect(body.skippedReasons.transcription_failed).toBe(1)
    // Nada deve ter sido inserido em generated_content
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('quando a transcrição sucede mas não detecta fala real (ex: só música), o item segue normalmente sem SRT', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    // transcribeOk=true (default) já retorna { srt:'', text:'' } — sem fala real detectada
    mockFetchForPrepare()

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { from, storage } = makeSupabaseMock({ candidateCount: 1, existingReadyCount: 0 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from, storage } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.prepared).toBe(1)
    expect(body.skippedReasons.transcription_failed).toBeUndefined()
  })

  it('REGRESSÃO (achado de revisão): 200 OK com corpo malformado NÃO conta como transcrição válida — item é pulado', async () => {
    mockGenerateStoredImage.mockResolvedValue('https://cdn.example.com/brand-bg.png')
    mockFetchForPrepare({ transcribeMalformed: true })

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { fromMock, storage } = makeSingleXCandidateMock()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock, storage } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare-brand/route')
    const req = new Request('http://localhost/api/cron/reels-prepare-brand')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // Antes do fix: transcriptionOk era marcado true ANTES do JSON.parse, então um
    // corpo malformado (200 OK) não disparava o gate — o vídeo ia ao ar sem legenda.
    expect(body.ok).toBe(true)
    expect(body.prepared).toBe(0)
    expect(body.skippedReasons.transcription_failed).toBe(1)
  })
})

describe('REGRESSÃO (achado de revisão): reserva de tempo por item evita estourar maxDuration=300s', () => {
  it('o loop reserva PER_ITEM_WORST_CASE_MS do TIME_BUDGET_MS antes de admitir um novo item', () => {
    const src = fs.readFileSync(path.resolve(__testdir, './route.ts'), 'utf-8')
    expect(src).toContain('const PER_ITEM_WORST_CASE_MS = 160_000')
    expect(src).toContain('Date.now() - runStart > TIME_BUDGET_MS - PER_ITEM_WORST_CASE_MS')
    // Não deve mais checar o budget bruto sem reserva
    expect(src).not.toMatch(/Date\.now\(\) - runStart > TIME_BUDGET_MS\)/)
  })
})
