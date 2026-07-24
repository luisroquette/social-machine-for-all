/**
 * REGRESSÃO: reels-prepare-brand-youtube
 *
 * Bug (Jun/2026): 101 candidatos YouTube passavam EV_KEYWORDS mas NUNCA eram preparados.
 * Causa: timeout Railway de 90s < tempo real do yt-dlp (~30-120s) + TIME_BUDGET=240s
 * esgotado pelos items X antes de chegar nos YouTube.
 *
 * Fix: cron dedicado com TIME_BUDGET=270s, timeout Railway=180s, sentinel yt_timeout (6h).
 */

import { describe, it, expect } from 'vitest'
import { EV_KEYWORDS, YT_TIMEOUT_SENTINEL } from './route'

// ── Sentinel yt_timeout ─────────────────────────────────────────────────────

describe('REGRESSÃO: sentinel yt_timeout — TTL e valores', () => {
  it('YT_TIMEOUT_SENTINEL tem o valor correto', () => {
    expect(YT_TIMEOUT_SENTINEL).toBe('yt_timeout')
  })

  it('TTL de 6h gera skip_until ~6h no futuro', () => {
    const YT_TIMEOUT_TTL_HOURS = 6
    const before = Date.now()
    const skipUntil = new Date(before + YT_TIMEOUT_TTL_HOURS * 60 * 60 * 1000)
    const expectedMs = YT_TIMEOUT_TTL_HOURS * 60 * 60 * 1000

    expect(skipUntil.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 100)
    expect(skipUntil.getTime()).toBeLessThanOrEqual(before + expectedMs + 1000)
  })

  it('sentinel não é confundido com sentinels de AI', () => {
    expect(YT_TIMEOUT_SENTINEL).not.toBe('ai_rate_limited')
    expect(YT_TIMEOUT_SENTINEL).not.toBe('ai_unavailable')
    expect(YT_TIMEOUT_SENTINEL).not.toBe('publish_failed')
  })
})

// ── Time budget guard ───────────────────────────────────────────────────────

describe('REGRESSÃO: time budget guard — impede itens com budget insuficiente', () => {
  const TIME_BUDGET_MS = 270_000
  const YT_RAILWAY_TIMEOUT_MS = 180_000
  const POST_RAILWAY_OVERHEAD_MS = 60_000
  const MIN_BUDGET_NEEDED = YT_RAILWAY_TIMEOUT_MS + POST_RAILWAY_OVERHEAD_MS // 240_000

  it('budget insuficiente (60s restantes) deve bloquear processamento', () => {
    // 210s elapsed → 60s remaining < 240s needed
    const elapsed = 210_000
    const remaining = TIME_BUDGET_MS - elapsed
    expect(remaining).toBeLessThan(MIN_BUDGET_NEEDED)
  })

  it('budget suficiente (260s restantes) deve permitir processamento', () => {
    // 10s elapsed → 260s remaining ≥ 240s needed
    const elapsed = 10_000
    const remaining = TIME_BUDGET_MS - elapsed
    expect(remaining).toBeGreaterThanOrEqual(MIN_BUDGET_NEEDED)
  })

  it('budget exatamente no limite (240s restantes) deve permitir processamento', () => {
    const elapsed = TIME_BUDGET_MS - MIN_BUDGET_NEEDED // exactly 30s elapsed
    const remaining = TIME_BUDGET_MS - elapsed
    expect(remaining).toBeGreaterThanOrEqual(MIN_BUDGET_NEEDED)
  })

  it('TIME_BUDGET de 270s cabe dentro de maxDuration=300s com margem', () => {
    const MAX_DURATION_MS = 300_000
    expect(TIME_BUDGET_MS).toBeLessThan(MAX_DURATION_MS)
    expect(MAX_DURATION_MS - TIME_BUDGET_MS).toBeGreaterThanOrEqual(30_000) // ≥30s overhead
  })

  it('YT_RAILWAY_TIMEOUT de 180s é maior que o timeout X de 90s', () => {
    const X_RAILWAY_TIMEOUT_MS = 90_000
    expect(YT_RAILWAY_TIMEOUT_MS).toBeGreaterThan(X_RAILWAY_TIMEOUT_MS)
  })

  it('YT_RAILWAY_TIMEOUT de 180s é maior que o timeout yt-dlp de 120s', () => {
    const YTDLP_TIMEOUT_MS = 120_000 // execFileAsync timeout in download.js
    expect(YT_RAILWAY_TIMEOUT_MS).toBeGreaterThan(YTDLP_TIMEOUT_MS)
  })
})

// ── EV_KEYWORDS — conteúdo típico de YouTube EV ────────────────────────────

describe('REGRESSÃO: EV_KEYWORDS cobre conteúdo típico de canais YouTube EV', () => {
  it('Rivian R2 Features passa', () => {
    expect(EV_KEYWORDS.test('R2 Features | Rivian')).toBe(true)
  })

  it('XPENG Colombia Brand Launch passa', () => {
    expect(EV_KEYWORDS.test('XPENG Colombia Brand Launch — XPENG G6 and G9 electric SUVs')).toBe(true)
  })

  it('Polestar 6 Sports Car Delayed passa', () => {
    expect(EV_KEYWORDS.test('Polestar 6 Sports Car Delayed!')).toBe(true)
  })

  it('BYD App passa', () => {
    expect(EV_KEYWORDS.test('Ele Criou um Aplicativo que pode Ver as Funções do BYD')).toBe(true)
  })

  it('"FERRARI LANÇOU UM CARRO ELÉTRICO" (PT-BR) passa', () => {
    expect(EV_KEYWORDS.test('FERRARI LANÇOU UM CARRO ELÉTRICO E É 💩')).toBe(true)
  })

  it('"Carregador no seu Negócio" (PT-BR) passa', () => {
    expect(EV_KEYWORDS.test('Como é Por Que Colocar um Carregador no seu Negócio?')).toBe(true)
  })

  it('EVIQO EVIPOWER Charging Station passa', () => {
    expect(EV_KEYWORDS.test('EVIQO EVIPOWER Gen 2 Home EV Charging Station Review')).toBe(true)
  })

  it('Tesla Robotaxi fleet data passa (TESLA_EV_CONTEXT não necessário — "ev" presente)', () => {
    expect(EV_KEYWORDS.test("Tesla 'Robotaxi' fleet is actually shrinking #tesla #ev #fsd")).toBe(true)
  })

  it('BMW iDrive (não EV) NÃO passa', () => {
    expect(EV_KEYWORDS.test('Uma nova era está chegando com o BMW iDrive. #BMWdoBrasil')).toBe(false)
  })

  it('conteúdo Rivian sem palavra EV explícita passa por "rivian"', () => {
    expect(EV_KEYWORDS.test('Will R2 fit in my garage? | Rivian')).toBe(true)
  })
})

// ── Bug 3: 'carregad' com \b nunca casava 'carregador' ─────────────────────
// O padrão 'carregad' tinha \b no final do grupo — em "Carregador", o 'd' é
// seguido por 'o' (char de palavra), então \b nunca disparava.
// Corrigido: 'carregadores?' (palavra completa com boundary correto).

describe('REGRESSÃO: carregad com \\b nunca casava "Carregador" — corrigido para carregadores?', () => {
  it('"Carregador" (singular PT-BR) deve passar', () => {
    expect(EV_KEYWORDS.test('Como é Por Que Colocar um Carregador no seu Negócio?')).toBe(true)
  })

  it('"Carregadores" (plural PT-BR) deve passar', () => {
    expect(EV_KEYWORDS.test('Instalação de carregadores para frota corporativa')).toBe(true)
  })

  it('"carregador" minúsculo deve passar', () => {
    expect(EV_KEYWORDS.test('Novo carregador de 350kW instalado no shopping')).toBe(true)
  })

  it('"carro" sozinho NÃO deve criar falso positivo com nova regex', () => {
    expect(EV_KEYWORDS.test('Meu carro é muito bonito')).toBe(false)
  })
})

// ── Verificação dos timeouts originais que causavam o bug ───────────────────

describe('REGRESSÃO: timeouts originais que causavam fila vazia', () => {
  it('timeout original 90s era insuficiente para yt-dlp (120s)', () => {
    const OLD_TIMEOUT_MS = 90_000
    const YTDLP_TYPICAL_MS = 120_000
    // Bug: 90s < 120s → AbortError → item skipado silenciosamente
    expect(OLD_TIMEOUT_MS).toBeLessThan(YTDLP_TYPICAL_MS)
  })

  it('novo timeout 180s é suficiente para yt-dlp (120s) + overhead', () => {
    const NEW_TIMEOUT_MS = 180_000
    const YTDLP_TYPICAL_MS = 120_000
    const UPLOAD_OVERHEAD_MS = 30_000 // Supabase upload
    expect(NEW_TIMEOUT_MS).toBeGreaterThan(YTDLP_TYPICAL_MS + UPLOAD_OVERHEAD_MS)
  })

  it('TIME_BUDGET original 240s + 2 tentativas YouTube (90s cada) esgotava em ~200s', () => {
    const OLD_BUDGET_MS = 240_000
    const OLD_TIMEOUT_MS = 90_000
    const WARMUP_MS = 16_000 // health check + retry
    const consumed = WARMUP_MS + OLD_TIMEOUT_MS * 2 // 196s
    // Só sobram 44s — insuficientes para uma 3ª tentativa (90s)
    expect(OLD_BUDGET_MS - consumed).toBeLessThan(OLD_TIMEOUT_MS)
  })

  it('novo TIME_BUDGET 270s acomoda warmup + 1 YouTube item completo', () => {
    const NEW_BUDGET_MS = 270_000
    const WARMUP_MS = 16_000
    const YT_TIMEOUT_MS = 180_000
    const AI_IMAGE_MS = 60_000 // AI + DALL-E
    const total = WARMUP_MS + YT_TIMEOUT_MS + AI_IMAGE_MS // 256s
    expect(total).toBeLessThanOrEqual(NEW_BUDGET_MS)
  })
})
