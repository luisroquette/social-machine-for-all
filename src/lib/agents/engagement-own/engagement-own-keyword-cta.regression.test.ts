import { describe, it, expect } from 'vitest'
import { isKeywordCta } from './index'

describe('REGRESSÃO: keyword CTA detection no engagement-own (X/Twitter)', () => {
  it('palavra única é CTA', () => {
    expect(isKeywordCta('LINK')).toBe(true)
    expect(isKeywordCta('MINI')).toBe(true)
    expect(isKeywordCta('REPO')).toBe(true)
    expect(isKeywordCta('SIM')).toBe(true)
  })

  it('duas palavras é CTA', () => {
    expect(isKeywordCta('QUERO REPO')).toBe(true)
    expect(isKeywordCta('ME MANDA')).toBe(true)
  })

  it('três ou mais palavras NÃO é CTA', () => {
    expect(isKeywordCta('quero o link')).toBe(false)
    expect(isKeywordCta('cara que incrível esse projeto')).toBe(false)
  })

  it('espaços extras não confundem a detecção', () => {
    expect(isKeywordCta('  LINK  ')).toBe(true)
    expect(isKeywordCta('  QUERO REPO  ')).toBe(true)
    expect(isKeywordCta('  quero o link  ')).toBe(false)
  })

  it('comentário vazio não é CTA', () => {
    expect(isKeywordCta('')).toBe(false)
    expect(isKeywordCta('   ')).toBe(false)
  })
})
