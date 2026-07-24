/**
 * REGRESSÃO: reels-prepare — dedup não bloqueia retry de failed (bug 2026-05-20)
 *
 * Mesmo bug da reels-prepare-brand:
 * O count query de dedup contava itens com status='failed'.
 * Após um item falhar (OpenAI billing, gate sem backgroundUrl, etc.),
 * o mesmo curated_content_id nunca mais era processado → deadlock permanente.
 *
 * Fix: `.not('status', 'eq', 'failed')` no count query — items failed são retentados.
 *
 * Garantia: `.not('status', 'eq', 'failed')` DEVE ser chamado na query de dedup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Fixa o clock fora de uma "pause week" (A3: epoch 2024-01-01, a cada 13 semanas
// reels-prepare pula tudo — ver `[reels-prepare] A3: Pause week` no route.ts).
// Sem isso, estes testes falham 1 semana a cada 13 (calendário-dependentes),
// exatamente como aconteceu em 29/06–06/07/2026 (semana 130, 130%13=0).
const FIXED_NOW_OUTSIDE_PAUSE_WEEK = new Date('2026-05-20T12:00:00Z')
import type { NextRequest } from 'next/server'

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: vi.fn().mockReturnValue(true),
}))

// ── Settings mock ─────────────────────────────────────────────────────────────

vi.mock('@/lib/settings/load-settings', () => ({
  getVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
    const defaults: Record<string, string> = {
      ai_keywords_pattern: 'openai|gpt|gemini|llm|ai|anthropic',
      instagram_handle: '@your_ai_profile',
      reference_style_account: '@uncover.ai',
      reel_prep_model: 'claude-sonnet-4-6',
    }
    return Promise.resolve(defaults[key] ?? '')
  }),
  getNumericVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
    const defaults: Record<string, number> = {
      reel_min_relevance_score: 20,
      reel_lookback_hours: 48,
      reel_candidate_limit: 20,
      reel_prep_max_tokens: 1500,
      reel_video_fps: 30,
    }
    return Promise.resolve(defaults[key] ?? null)
  }),
}))

// ── Sentry mock ───────────────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

// ── generateStoredImage mock ──────────────────────────────────────────────────

vi.mock('@/lib/ai/openai-image', () => ({
  generateStoredImage: vi.fn().mockResolvedValue('https://cdn.example.com/bg-raw.png'),
}))

vi.mock('@/lib/ai/generate-with-fallback', () => ({
  generateTextWithFallback: vi.fn().mockResolvedValue(
    '{"srt_ptbr":"","hookTitle":"AI TITULO TESTE","highlightWords":["AI"],"subtitle":"teste IA","imagePrompt":"dark studio AI render","caption":"Caption de teste para IA."}'
  ),
  aiSentinelCode: vi.fn().mockReturnValue('ai_error'),
  AI_SENTINEL: { RATE_LIMITED: 'ai_rate_limited', UNAVAILABLE: 'ai_unavailable' },
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

// ── Fetch mock (Railway warmup + video + transcription + Anthropic) ───────────

function setupFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/health')) return { ok: true, json: async () => ({ ok: true }) }
    if (url.includes('cdn.example.com/video.mp4')) {
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1024) }
    }
    if (url.includes('/transcribe')) return { ok: false }
    if (url.includes('anthropic.com')) {
      return {
        ok: true,
        json: async () => ({
          content: [{
            text: JSON.stringify({
              srt_ptbr: '',
              hookTitle: 'OPENAI LANÇA MODELO REVOLUCIONÁRIO',
              highlightWords: ['OPENAI'],
              subtitle: 'novo modelo IA',
              imagePrompt: 'Futuristic AI robot studio photorealistic',
              caption: 'OpenAI acaba de anunciar um modelo que muda tudo. A inteligência artificial nunca mais será a mesma. Prepare-se para o futuro. #IA #OpenAI #Tech',
            }),
          }],
        }),
      }
    }
    return { ok: false }
  }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: reels-prepare — dedup não bloqueia retry de failed (bug 2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW_OUTSIDE_PAUSE_WEEK)
    setupFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('DEDUP: items com status=failed são retentados — .not("status","eq","failed") é chamado', async () => {
    const { getAdminClient } = await import('@/lib/supabase/admin')

    // Spy para capturar a chamada .not() no count query de dedup
    const notSpy = vi.fn().mockReturnThis()
    const headSpy = vi.fn().mockResolvedValue({ count: 0 }) // 0 registros não-failed → pode processar

    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: notSpy,
          head: headSpy,
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
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
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-ai-1',
              source_url: 'https://x.com/user/status/999',
              source_content: 'OpenAI anuncia modelo revolucionário que transforma o futuro da inteligência artificial global em 2026 com capacidades nunca vistas',
              source_author: 'ainews',
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
    vi.mocked(getAdminClient).mockReturnValue({
      from: fromMock,
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }),
        })),
      },
    } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare/route')
    const req = new Request('http://localhost/api/cron/reels-prepare')
    await GET(req as NextRequest)

    // DEVE ter chamado .not('status', 'eq', 'failed') no dedup check
    expect(notSpy).toHaveBeenCalledWith('status', 'eq', 'failed')
  })

  it('DEDUP: item com registro failed existente é reprocessado (count retorna 0 após excluir failed)', async () => {
    const { getAdminClient } = await import('@/lib/supabase/admin')
    const { generateStoredImage } = await import('@/lib/ai/openai-image')

    vi.mocked(generateStoredImage).mockResolvedValue('https://cdn.example.com/bg-raw.png')

    // Simula: existe 1 registro mas com status=failed → count pós-.not() = 0 → deve processar
    const headSpy = vi.fn().mockResolvedValue({ count: 0 }) // não-failed count = 0

    const insertSpy = vi.fn().mockResolvedValue({ error: null })

    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          head: headSpy,
          insert: insertSpy,
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
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
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-ai-2',
              source_url: 'https://x.com/user/status/888',
              source_content: 'OpenAI GPT-5 lançado com capacidades multimodais sem precedentes transformando o mercado global de IA em 2026 para sempre',
              source_author: 'techcrunch',
              relevance_score: 95,
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
    vi.mocked(getAdminClient).mockReturnValue({
      from: fromMock,
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }),
        })),
      },
    } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare/route')
    const req = new Request('http://localhost/api/cron/reels-prepare')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // Item deve ter sido processado (não bloqueado pelo dedup)
    expect(body.ok).toBe(true)
    expect(body.prepared).toBe(1)
    expect(body.authors).toEqual(expect.arrayContaining(['techcrunch']))
  })
})

/**
 * REGRESSÃO: reels-prepare — OOM em vídeos 4K (bug 2026-05-22)
 *
 * Buffer.from(await vidRes.arrayBuffer()) em vídeos 4K do Twitter (200-500MB)
 * causava V8 OOM fatal — o processo Node.js morria, bypassando todo try/catch
 * e fazendo a Vercel retornar HTML 500 (não JSON).
 *
 * Fix: Content-Length guard em uploadAndGetUrl() — vídeos >50MB ou sem header
 * Content-Length retornam a URL direta sem tentar bufferizar.
 *
 * Garantia: fetch NÃO deve ter arrayBuffer() chamado para vídeos grandes.
 */
describe('REGRESSÃO: reels-prepare — OOM em vídeos 4K (bug 2026-05-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW_OUTSIDE_PAUSE_WEEK)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('vídeo grande (>50MB) usa URL direta sem chamar arrayBuffer', async () => {
    vi.mock('@/lib/api/auth', () => ({ isCronRequest: vi.fn().mockReturnValue(true) }))
    vi.mock('@/lib/settings/load-settings', () => ({
      getVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
        const defaults: Record<string, string> = {
          ai_keywords_pattern: 'openai|gpt|gemini|llm|ai|anthropic',
          instagram_handle: '@your_ai_profile',
          reference_style_account: '@uncover.ai',
          reel_prep_model: 'claude-sonnet-4-6',
        }
        return Promise.resolve(defaults[key] ?? '')
      }),
      getNumericVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
        const defaults: Record<string, number> = {
          reel_min_relevance_score: 20,
          reel_lookback_hours: 48,
          reel_candidate_limit: 20,
          reel_prep_max_tokens: 1500,
          reel_video_fps: 30,
        }
        return Promise.resolve(defaults[key] ?? null)
      }),
    }))
    vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }))
    vi.mock('@/lib/ai/openai-image', () => ({
      generateStoredImage: vi.fn().mockResolvedValue('https://cdn.example.com/bg-raw.png'),
    }))
    vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }))

    const arrayBufferSpy = vi.fn()
    const cancelSpy = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('fetch', vi.fn(async (url: string, _opts?: RequestInit) => {
      if (url.includes('/health')) return { ok: true, json: async () => ({ ok: true }) }
      if (url.includes('video.twimg.com')) {
        // Simula vídeo 4K: Content-Length = 400MB
        return {
          ok: true,
          headers: { get: (h: string) => h === 'content-length' ? '419430400' : null },
          arrayBuffer: arrayBufferSpy, // NUNCA deve ser chamado
          body: { cancel: cancelSpy },
        }
      }
      if (url.includes('anthropic.com')) {
        return {
          ok: true,
          json: async () => ({
            content: [{ text: JSON.stringify({
              srt_ptbr: '',
              hookTitle: 'OPENAI LANÇA MODELO',
              highlightWords: ['OPENAI'],
              subtitle: 'novo modelo',
              imagePrompt: 'Futuristic AI studio photorealistic',
              caption: 'OpenAI acaba de anunciar um modelo revolucionário.',
            }) }],
          }),
        }
      }
      return { ok: false }
    }))

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          head: vi.fn().mockResolvedValue({ count: 0 }),
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
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
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-4k-1',
              source_url: 'https://x.com/user/status/777',
              source_content: 'OpenAI anuncia modelo GPT revolucionário com inteligência artificial nunca vista em 2026',
              source_author: 'bigtech',
              relevance_score: 90,
              source_metrics: {
                media_types: ['video'],
                video_url: 'https://video.twimg.com/amplify_video/3840x2160/high.mp4',
              },
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
    vi.mocked(getAdminClient).mockReturnValue({
      from: fromMock,
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/video.mp4' } }),
        })),
      },
    } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare/route')
    const req = new Request('http://localhost/api/cron/reels-prepare')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    // Função deve retornar 200 (não crashar com OOM)
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    // arrayBuffer NUNCA deve ter sido chamado no vídeo 4K
    expect(arrayBufferSpy).not.toHaveBeenCalled()

    // body.cancel() deve ter sido chamado para liberar a conexão
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('vídeo sem Content-Length usa URL direta (não tenta bufferizar)', async () => {
    vi.mock('@/lib/api/auth', () => ({ isCronRequest: vi.fn().mockReturnValue(true) }))
    vi.mock('@/lib/settings/load-settings', () => ({
      getVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
        const d: Record<string, string> = {
          ai_keywords_pattern: 'openai|gpt|ai',
          instagram_handle: '@x',
          reference_style_account: '@y',
          reel_prep_model: 'claude-sonnet-4-6',
        }
        return Promise.resolve(d[key] ?? '')
      }),
      getNumericVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
        const d: Record<string, number> = {
          reel_min_relevance_score: 20,
          reel_lookback_hours: 48,
          reel_candidate_limit: 20,
          reel_prep_max_tokens: 1500,
          reel_video_fps: 30,
        }
        return Promise.resolve(d[key] ?? null)
      }),
    }))
    vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }))
    vi.mock('@/lib/ai/openai-image', () => ({
      generateStoredImage: vi.fn().mockResolvedValue('https://cdn.example.com/bg.png'),
    }))
    vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }))

    const arrayBufferSpy = vi.fn()

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/health')) return { ok: true, json: async () => ({ ok: true }) }
      if (url.includes('video.twimg.com')) {
        return {
          ok: true,
          headers: { get: (_h: string) => null }, // sem Content-Length
          arrayBuffer: arrayBufferSpy,
          body: { cancel: vi.fn().mockResolvedValue(undefined) },
        }
      }
      if (url.includes('anthropic.com')) {
        return {
          ok: true,
          json: async () => ({
            content: [{ text: JSON.stringify({
              srt_ptbr: '',
              hookTitle: 'GPT REVOLUCIONA IA',
              highlightWords: ['GPT'],
              subtitle: 'ai news',
              imagePrompt: 'Futuristic AI studio',
              caption: 'OpenAI GPT transforma o futuro.',
            }) }],
          }),
        }
      }
      return { ok: false }
    }))

    const { getAdminClient } = await import('@/lib/supabase/admin')
    const fromMock = vi.fn((table: string) => {
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(), head: vi.fn().mockResolvedValue({ count: 0 }),
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
        }
      }
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(), contains: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'content-nolen-1',
              source_url: 'https://x.com/user/status/555',
              source_content: 'OpenAI GPT-5 lançado com capacidades multimodais de inteligência artificial em 2026',
              source_author: 'aireporter',
              relevance_score: 85,
              source_metrics: { media_types: ['video'], video_url: 'https://video.twimg.com/unknown.mp4' },
            }],
          }),
          update: vi.fn(() => { const c: Record<string, unknown> = {}; c.eq = vi.fn(() => c); c.in = vi.fn(() => c); c.lt = vi.fn(() => Promise.resolve({ error: null })); return c }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(), head: vi.fn().mockResolvedValue({ count: 0 }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminClient).mockReturnValue({
      from: fromMock,
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/v.mp4' } }),
        })),
      },
    } as any)

    const { GET } = await import('@/app/api/cron/reels-prepare/route')
    const req = new Request('http://localhost/api/cron/reels-prepare')
    const res = await GET(req as NextRequest)

    expect(res.status).toBe(200)
    // arrayBuffer nunca chamado — vídeo sem Content-Length usa URL direta
    expect(arrayBufferSpy).not.toHaveBeenCalled()
  })
})

// ── REGRESSÃO: notificação de e-mail (Resend) tem timeout (auditoria 2026-07-15) ──────────

describe('REGRESSÃO: fetch da notificação de e-mail (Resend) tem timeout explícito', () => {
  it('sendFirstImageNotificationEmail: fetch ao Resend tem AbortSignal.timeout', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/cron/reels-prepare/route.ts'), 'utf-8')
    const block = src.slice(src.indexOf("fetch('https://api.resend.com/emails'"))
    expect(block.slice(0, 300)).toContain('AbortSignal.timeout')
  })
})
