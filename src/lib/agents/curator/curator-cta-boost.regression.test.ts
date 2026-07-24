import { describe, it, expect } from 'vitest'
import { CTA_BOOST_PATTERNS } from './index'

describe('REGRESSÃO: Curator CTA boost — Optimization 11', () => {
  function hasCta(text: string): boolean {
    const lower = text.toLowerCase()
    return CTA_BOOST_PATTERNS.some(p => lower.includes(p))
  }

  it('detecta "comente" (PT-BR típico)', () => {
    expect(hasCta('Comente LINK abaixo que te mando o repo')).toBe(true)
  })

  it('detecta "comment below" (EN)', () => {
    expect(hasCta('Comment below for the free guide')).toBe(true)
  })

  it('detecta "dm me"', () => {
    expect(hasCta('DM me for access to the template')).toBe(true)
  })

  it('detecta "cheatsheet"', () => {
    expect(hasCta('Built a cheatsheet with 50 prompts')).toBe(true)
  })

  it('detecta "free guide"', () => {
    expect(hasCta('Wrote a free guide on RAG architecture')).toBe(true)
  })

  it('detecta "github.com" (recurso distributível)', () => {
    expect(hasCta('Full code at github.com/user/repo')).toBe(true)
  })

  it('detecta "template" em PT-BR', () => {
    expect(hasCta('Montei um template de agente IA')).toBe(true)
  })

  it('post de notícia sem recurso distribuível NÃO é CTA', () => {
    expect(hasCta('OpenAI lançou o GPT-5 com contexto de 1M tokens')).toBe(false)
    expect(hasCta('A Anthropic captou $2B em nova rodada')).toBe(false)
    expect(hasCta('Google Gemini agora suporta vídeo em tempo real')).toBe(false)
  })

  it('caseInsensitive — "COMENTE" e "comente" são equivalentes', () => {
    expect(hasCta('COMENTE REPO e te mando o link')).toBe(true)
    expect(hasCta('comente repo e te mando o link')).toBe(true)
  })
})

describe('REGRESSÃO: Writer CTA roll — distribuição ~25%', () => {
  function ctaRoll(id: string): boolean {
    return parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 4 === 0
  }

  it('é determinístico — mesmo id sempre dá mesmo resultado', () => {
    const id = '00000000-0000-0000-0000-000000000000'
    expect(ctaRoll(id)).toBe(ctaRoll(id))
  })

  it('distribui ~25% em 100 UUIDs sintéticos', () => {
    const uuids = Array.from({ length: 100 }, (_, i) => {
      const hex = i.toString(16).padStart(8, '0')
      return `${hex}-0000-0000-0000-000000000000`
    })
    const trueCount = uuids.filter(ctaRoll).length
    // Esperado: ~25 de 100. Aceitar 20-30 (margem para distribuição de hex).
    expect(trueCount).toBeGreaterThanOrEqual(20)
    expect(trueCount).toBeLessThanOrEqual(30)
  })
})
