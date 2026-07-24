import { describe, it, expect } from 'vitest'
import { stripExternalLinksForX } from './index'

describe('REGRESSÃO: stripExternalLinksForX — links externos nunca chegam ao X', () => {
  it('remove link instagram.com', () => {
    const result = stripExternalLinksForX('Veja o vídeo completo em https://instagram.com/p/xyz aqui')
    expect(result).not.toContain('instagram.com')
    expect(result).toContain('Veja o vídeo completo em')
  })

  it('remove link youtube.com', () => {
    const result = stripExternalLinksForX('Full tutorial: https://youtube.com/watch?v=abc123')
    expect(result).not.toContain('youtube.com')
  })

  it('remove link linkedin.com', () => {
    const result = stripExternalLinksForX('Post original: https://linkedin.com/posts/xyz')
    expect(result).not.toContain('linkedin.com')
  })

  it('remove qualquer domínio externo genérico', () => {
    const result = stripExternalLinksForX('Leia em https://techcrunch.com/article/ai-news')
    expect(result).not.toContain('techcrunch.com')
  })

  it('preserva links x.com (internos)', () => {
    const input = 'Esse fio em https://x.com/karpathy/status/123456 é ouro'
    const result = stripExternalLinksForX(input)
    expect(result).toContain('https://x.com/karpathy/status/123456')
  })

  it('preserva links t.co (encurtados do X)', () => {
    const input = 'Resumo aqui https://t.co/AbCdEfGh'
    const result = stripExternalLinksForX(input)
    expect(result).toContain('https://t.co/AbCdEfGh')
  })

  it('preserva links twitter.com (alias do X)', () => {
    const input = 'Thread original: https://twitter.com/sama/status/99999'
    const result = stripExternalLinksForX(input)
    expect(result).toContain('https://twitter.com/sama/status/99999')
  })

  it('texto sem links passa inalterado', () => {
    const input = 'GPT-5 chega em Q3/2025 com contexto de 1M tokens e custo 10x menor'
    expect(stripExternalLinksForX(input)).toBe(input)
  })

  it('espaços extras colapsados após remoção', () => {
    const result = stripExternalLinksForX('Antes https://instagram.com/p/xyz depois')
    expect(result).not.toMatch(/  /)   // sem double-space
    expect(result).toBe('Antes depois')
  })

  it('múltiplos links externos removidos de uma vez', () => {
    const input = 'Veja https://instagram.com/p/a e https://youtube.com/watch?v=b para mais'
    const result = stripExternalLinksForX(input)
    expect(result).not.toContain('instagram.com')
    expect(result).not.toContain('youtube.com')
    expect(result).toContain('Veja')
    expect(result).toContain('para mais')
  })
})

describe('REGRESSÃO: writer — regra no system prompt proíbe links externos explicitamente', () => {
  it('system prompt menciona penalidade do X para links externos', () => {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const src = readFileSync(join(process.cwd(), 'src/lib/agents/writer/index.ts'), 'utf-8')
    // A regra deve explicar a penalidade, não apenas dizer "zero links"
    expect(src).toMatch(/penaliza\s+posts\s+que\s+tiram\s+trafego/)
    // Deve citar exemplos concretos de domínios externos proibidos
    expect(src).toMatch(/instagram\.com/)
    expect(src).toMatch(/youtube\.com/)
    // Deve permitir x.com explicitamente
    expect(src).toMatch(/x\.com.*permitidos/i)
  })

  it('post-processing chama stripExternalLinksForX para plataforma X', () => {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const src = readFileSync(join(process.cwd(), 'src/lib/agents/writer/index.ts'), 'utf-8')
    expect(src).toContain('stripExternalLinksForX')
    expect(src).toMatch(/isXPlatform[\s\S]{0,200}stripExternalLinksForX/)
  })
})
