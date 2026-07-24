/**
 * REGRESSÃO: CTA "comenta X" deve ser throttled a máx 2 por janela de 3 dias.
 * Bug: sem enforcement no código, o LLM pode postar "comenta QUERO" 7 dias seguidos — flag de spam.
 * Fix: hasCommentCta() + isCommentCtaThrottled() + stripCommentCta() no publisher.
 */
import { describe, it, expect } from 'vitest'

// Extraído para teste sem importar o módulo completo do publisher
const COMMENT_CTA_REGEX = /(^|\n|[.!?]\s+)comenta\s+\w+/i

function hasCommentCta(caption: string): boolean {
  return COMMENT_CTA_REGEX.test(caption)
}

function stripCommentCta(caption: string): string {
  return caption.replace(/(^|\n|[.!?]\s+)comenta\s+\w+[^\n]*/gi, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

describe('REGRESSÃO: hasCommentCta — detecção de CTA de comentário', () => {
  it('detecta "comenta SIM"', () => {
    expect(hasCommentCta('Hook.\n\nContexto.\n\nComenta SIM se quer saber mais.')).toBe(true)
  })

  it('detecta "comenta aqui"', () => {
    expect(hasCommentCta('Texto\n\ncomenta aqui 👇')).toBe(true)
  })

  it('detecta "comenta abaixo"', () => {
    expect(hasCommentCta('Post\n\nComenta abaixo o que você acha')).toBe(true)
  })

  it('detecta "comenta QUERO"', () => {
    expect(hasCommentCta('Quer o template? Comenta QUERO')).toBe(true)
  })

  it('NÃO dispara em CTA de compartilhamento', () => {
    expect(hasCommentCta('Salva esse post para não perder.')).toBe(false)
  })

  it('NÃO dispara em uso normal da palavra "comenta"', () => {
    expect(hasCommentCta('A imprensa comenta sobre a nova regulação.')).toBe(false)
  })

  it('NÃO dispara em caption sem CTA', () => {
    expect(hasCommentCta('Hook forte.\n\nContexto com dado.\n\nSiga para mais.')).toBe(false)
  })
})

describe('REGRESSÃO: stripCommentCta — remoção do CTA throttled', () => {
  it('remove linha com "comenta X" e não deixa linhas triplas', () => {
    const caption = 'Hook.\n\nContexto.\n\nComenta SIM se quiser mais.\n\n@handle'
    const result = stripCommentCta(caption)
    expect(result).not.toMatch(/comenta\s+\w+/i)
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('preserva o restante da caption intacto', () => {
    const caption = 'Hook aqui.\n\nDado importante.\n\nComenta QUERO para receber.\n\n@brand'
    const result = stripCommentCta(caption)
    expect(result).toContain('Hook aqui.')
    expect(result).toContain('Dado importante.')
    expect(result).toContain('@brand')
  })
})
