/**
 * REGRESSÃO: bugs do reel Telangana/Índia publicado em 2026-07-06 no @brand
 *
 * Bug A (priorização Brasil): sortBrazilFirst() garante que candidatos com
 *   score_breakdown.brazil_scoped=true são tentados antes de conteúdo global —
 *   conteúdo global só é fallback quando o BR se esgota.
 *
 * Bug B (autointeligibilidade): buildbrandAiPrompt() agora exige que o
 *   hookTitle/subtitle deixe explícito o país/origem quando o conteúdo não for
 *   sobre o Brasil — o hook "6.000 ELETROPOSTOS ATÉ 2030" (sem dizer "Índia")
 *   fazia o público achar que o número era do mercado brasileiro.
 */

import { describe, it, expect } from 'vitest'
import { sortBrazilFirst, buildbrandAiPrompt } from './_shared'

describe('REGRESSÃO: sortBrazilFirst — conteúdo BR tentado antes do global', () => {
  it('coloca itens brazil_scoped=true antes dos demais', () => {
    const items = [
      { id: 'global-1', score_breakdown: { brazil_scoped: false } },
      { id: 'br-1', score_breakdown: { brazil_scoped: true } },
      { id: 'global-2', score_breakdown: { brazil_scoped: false } },
      { id: 'br-2', score_breakdown: { brazil_scoped: true } },
    ]
    const sorted = sortBrazilFirst(items)
    expect(sorted.map(i => i.id)).toEqual(['br-1', 'br-2', 'global-1', 'global-2'])
  })

  it('preserva a ordem relativa dentro de cada grupo (partição estável)', () => {
    const items = [
      { id: 'br-3', score_breakdown: { brazil_scoped: true } },
      { id: 'br-1', score_breakdown: { brazil_scoped: true } },
      { id: 'global-2', score_breakdown: { brazil_scoped: false } },
      { id: 'global-1', score_breakdown: { brazil_scoped: false } },
    ]
    const sorted = sortBrazilFirst(items)
    expect(sorted.map(i => i.id)).toEqual(['br-3', 'br-1', 'global-2', 'global-1'])
  })

  it('itens sem score_breakdown (ex: YouTube, sem tagging) vão para o grupo global', () => {
    const items = [
      { id: 'no-tag' },
      { id: 'br-1', score_breakdown: { brazil_scoped: true } },
    ]
    const sorted = sortBrazilFirst(items)
    expect(sorted.map(i => i.id)).toEqual(['br-1', 'no-tag'])
  })

  it('score_breakdown presente mas sem brazil_scoped conta como global', () => {
    const items = [
      { id: 'no-flag', score_breakdown: { category: 'ev_news' } },
      { id: 'br-1', score_breakdown: { brazil_scoped: true } },
    ]
    const sorted = sortBrazilFirst(items)
    expect(sorted.map(i => i.id)).toEqual(['br-1', 'no-flag'])
  })

  it('lista vazia retorna lista vazia', () => {
    expect(sortBrazilFirst([])).toEqual([])
  })
})

describe('REGRESSÃO: buildbrandAiPrompt exige autointeligibilidade + país quando não é Brasil', () => {
  it('instrui explicitamente a incluir o país/origem quando o conteúdo não é do Brasil', () => {
    const prompt = buildbrandAiPrompt({
      srtText: '',
      instagramHandle: '@brand',
      sourceContent: 'O estado indiano de Telangana virou referência mundial em mobilidade elétrica',
      fullText: '',
    })
    expect(prompt).toMatch(/autointeligibilidade/i)
    expect(prompt).toContain('ÍNDIA')
    expect(prompt).toMatch(/n[ãa]o.{0,10}(seja|for).{0,20}brasil/i)
  })

  it('a regra de autointeligibilidade aparece na seção do hookTitle (TAREFA 2), não fora do prompt', () => {
    const prompt = buildbrandAiPrompt({
      srtText: '', instagramHandle: '@brand', sourceContent: 'x', fullText: '',
    })
    const tarefa2 = prompt.slice(prompt.indexOf('TAREFA 2'), prompt.indexOf('TAREFA 3'))
    expect(tarefa2).toMatch(/autointeligibilidade/i)
  })
})

describe('REGRESSÃO: buildbrandAiPrompt mantém trilho narrativo B2B sem clickbait', () => {
  it('instrui problema de negócio, prova/contexto, consequência e takeaway', () => {
    const prompt = buildbrandAiPrompt({
      srtText: '',
      instagramHandle: '@brand',
      sourceContent: 'Condomínios ampliam eletropostos para atender veículos elétricos',
      fullText: '',
    })
    expect(prompt).toContain('ESTRUTURA NARRATIVA RECOMENDADA')
    expect(prompt).toContain('PROBLEMA DE NEGÓCIO')
    expect(prompt).toContain('PROVA/CONTEXTO')
    expect(prompt).toContain('CONSEQUÊNCIA')
    expect(prompt).toContain('TAKEAWAY')
    expect(prompt).toMatch(/sem clickbait/i)
  })
})
