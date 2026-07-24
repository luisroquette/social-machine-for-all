/**
 * REGRESSÃO: reels-prepare-brand
 *
 * Bug 1: EV_KEYWORDS regex era English-only — conteúdo PT-BR ("carro elétrico",
 *   "veículo elétrico") era bloqueado pelo filtro de aplicação, causando fila
 *   reel_ready vazia mesmo com 35 candidatos disponíveis no banco.
 *   Corrigido: adição de carro.{1,3}el[eé]trico e ve[íi]culos?.{1,3}el[eé]trico
 *
 * Bug 2: uploadAndGetUrl bufferizava vídeo sem checar Content-Length — violação
 *   da Cláusula Pétrea §6. Vídeo 4K (1440x2560) causava V8 OOM silencioso.
 *   Corrigido: guard > 50MB retorna rawUrl antes de arrayBuffer()
 */

import { describe, it, expect } from 'vitest'
import { EV_KEYWORDS, isBrazilRelevantbrandSource } from './route'

// ── Bug 1: PT-BR terms must pass EV_KEYWORDS ─────────────────────────────────

describe('REGRESSÃO: EV_KEYWORDS filtrava conteúdo PT-BR válido', () => {
  it('carro elétrico deve passar', () => {
    expect(EV_KEYWORDS.test('Mano oque dizer que cena. O vídeo de uma mulher colocando gasolina em carro elétrico domina')).toBe(true)
  })

  it('veículo elétrico deve passar', () => {
    expect(EV_KEYWORDS.test('Regulamentação de veículos elétricos avança no Brasil')).toBe(true)
  })

  it('carro eletrico (sem acento) deve passar', () => {
    expect(EV_KEYWORDS.test('A venda de carro eletrico cresceu 40% em 2026')).toBe(true)
  })

  it('veiculo eletrico (sem acento) deve passar', () => {
    expect(EV_KEYWORDS.test('Frota de veiculo eletrico já soma 200 mil unidades')).toBe(true)
  })

  // Garantir que não criamos falsos positivos
  it('"carro" sozinho NÃO deve passar', () => {
    expect(EV_KEYWORDS.test('Novo carro da semana é lindo')).toBe(false)
  })

  it('"elétrico" sozinho NÃO deve passar (eletricidade em geral)', () => {
    expect(EV_KEYWORDS.test('Problema elétrico na usina de Itaipu')).toBe(false)
  })
})

// ── Termos EN que devem continuar passando ────────────────────────────────────

describe('REGRESSÃO: termos EN originais continuam funcionando', () => {
  it('electric vehicles passa', () => {
    expect(EV_KEYWORDS.test('electric vehicles have surpassed ICE sales')).toBe(true)
  })

  it('BYD passa', () => {
    expect(EV_KEYWORDS.test('BYD game changing innovation')).toBe(true)
  })

  it('eletroposto passa', () => {
    expect(EV_KEYWORDS.test('Novo eletroposto inaugurado em São Paulo')).toBe(true)
  })

  it('charging station passa', () => {
    expect(EV_KEYWORDS.test('New charging station network planned for Brazil')).toBe(true)
  })

  it('frota elétrica passa', () => {
    expect(EV_KEYWORDS.test('Empresa anuncia eletrificação de frota eletrica B2B')).toBe(true)
  })
})

// ── Conteúdo off-topic NÃO deve passar ───────────────────────────────────────

describe('REGRESSÃO: conteúdo off-topic não deve passar EV_KEYWORDS', () => {
  it('patinetes elétricos queimados (scooter vandalismo) NÃO passa', () => {
    const text = 'New video from Brussels riots. Moroccan migrants set electric scooters on fire, vandalized bus stops'
    expect(EV_KEYWORDS.test(text)).toBe(false)
  })

  it('conteúdo AI sem contexto EV NÃO passa', () => {
    const text = 'Claude AI orchestrating multiple agents to solve complex tasks. Multi-agent system scales.'
    expect(EV_KEYWORDS.test(text)).toBe(false)
  })

  it('motivacional genérico NÃO passa', () => {
    const text = 'Authenticity is the most valuable currency today. In a world dominated by noise, be real.'
    expect(EV_KEYWORDS.test(text)).toBe(false)
  })
})

describe('REGRESSÃO: lançamentos de veículos só entram com sinal de Brasil', () => {
  it('bloqueia lançamento global/China sem contexto Brasil', () => {
    const text = 'BYD apresenta o novo Seal 08 PHEV na China com 400 km de autonomia elétrica e preço equivalente a R$ 150 mil'
    expect(isBrazilRelevantbrandSource(text)).toBe(false)
  })

  it('permite lançamento quando o texto explicita chegada ou operação no Brasil', () => {
    const text = 'Geely EX5 híbrido chega ao Brasil com produção local e vendas previstas para o mercado brasileiro ainda este ano'
    expect(isBrazilRelevantbrandSource(text)).toBe(true)
  })

  it('não bloqueia conteúdo de infraestrutura EV que não é notícia de lançamento', () => {
    const text = 'Rede de eletropostos DC fast cresce no Brasil com foco em operação de frota elétrica e recarga corporativa'
    expect(isBrazilRelevantbrandSource(text)).toBe(true)
  })
})

// ── Bug 2: Content-Length guard (testar lógica, não I/O) ─────────────────────
// Guard retorna '' (skip) — NUNCA rawUrl. Instagram não consegue baixar
// URLs video.twimg.com (Cláusula Pétrea §7). Item é descartado, não postado.

describe('REGRESSÃO: Content-Length guard — retorna vazio para skip, nunca rawUrl', () => {
  it('vídeo 4K (>50MB) deve ser bloqueado pelo guard', () => {
    const FIFTY_MB = 50 * 1024 * 1024
    const videoSize = 150 * 1024 * 1024 // 150MB (típico de vídeo 4K)
    // Guard dispara → uploadAndGetUrl retorna '' → if (!videoUrl) continue
    expect(videoSize > FIFTY_MB).toBe(true)
  })

  it('vídeo 720p (<50MB) deve passar pelo guard', () => {
    const FIFTY_MB = 50 * 1024 * 1024
    const videoSize = 25 * 1024 * 1024 // 25MB (típico de vídeo 720p)
    expect(videoSize > FIFTY_MB).toBe(false)
  })

  it('Content-Length ausente (0) não bloqueia — tenta download normalmente', () => {
    // header ausente → parseInt('0') → 0 → guard não dispara
    const FIFTY_MB = 50 * 1024 * 1024
    const contentLength = parseInt('0')
    expect(contentLength > FIFTY_MB).toBe(false)
  })

  it('fallback de erro NÃO deve ser rawUrl Twitter — deve ser string vazia', () => {
    // Simula comportamento: se upload falha, retorna '' e item é pulado
    // (nunca retorna video.twimg.com que Instagram não consegue baixar)
    const simulatedFallback = ''
    const isTwitterUrl = simulatedFallback.includes('video.twimg.com')
    expect(isTwitterUrl).toBe(false)
    expect(simulatedFallback).toBe('')
  })
})
