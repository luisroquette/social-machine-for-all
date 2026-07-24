import { describe, expect, it } from 'vitest'
import {
  applyEditorialStyleRotation,
  buildEditorialCoverCandidates,
  buildEditorialHookCandidates,
  pickTrendEditorialTemplate,
} from './trend-editorial-templates'

describe('trend editorial templates', () => {
  it('seleciona IA inacreditavel para temas de IA', () => {
    const template = pickTrendEditorialTemplate({
      topic: 'Claude Code e OpenAI dominaram as buscas',
      category: 'technology',
    })

    expect(template.id).toBe('ia_inacreditavel')
    expect(template.label).toBe('IA inacreditavel')
  })

  it('seleciona anime hype para temas de anime', () => {
    const template = pickTrendEditorialTemplate({
      topic: 'One Piece viralizou no Brasil',
      category: 'entertainment',
    })

    expect(template.id).toBe('anime_hype')
  })

  it('injeta presets editoriais na rotacao de estilo', () => {
    const template = pickTrendEditorialTemplate({
      topic: 'Neymar',
      category: 'sports',
    })

    expect(applyEditorialStyleRotation(['ultrarealista', 'anime'], template).slice(0, 3)).toEqual([
      'ultrarealista',
      'anime-stadium',
      'abstrato-graphic',
    ])
  })

  it('gera hooks e capas alinhados ao template', () => {
    const template = pickTrendEditorialTemplate({
      topic: 'Claude',
      category: 'technology',
    })

    expect(buildEditorialHookCandidates(template, 'Claude').some((item) => item.includes('CLAUDE'))).toBe(true)
    expect(buildEditorialCoverCandidates(template, 'Claude').some((item) => item.includes('CLAUDE'))).toBe(true)
  })

  it('REGRESSAO: varia o template entre topicos sem keyword especifica (nao trava sempre no mesmo default de categoria)', () => {
    // Bug real: bonus fixos no score (luxo_cinema +1 sempre, tech_futurista +2 para
    // technology) faziam qualquer topico sem keyword especifica da mesma categoria cair
    // sempre no mesmo template ("tech_futurista" para tech, "luxo_cinema" para o resto).
    // Nenhum desses topicos casa com keywordPattern de nenhum template.
    const topics = [
      'Midjourney V8', 'Sora 2', 'Runway Gen5', 'Perplexity Pro', 'Grok 4',
      'Mistral Large', 'Qwen Max', 'Nano Banana', 'DeepSeek R2', 'Llama 4',
    ]
    const ids = new Set(topics.map((topic) => pickTrendEditorialTemplate({ topic, category: 'technology' }).id))
    expect(ids.size, `deveria variar o template, teve: ${[...ids].join(', ')}`).toBeGreaterThanOrEqual(2)
  })

  it('preferredTemplateId ainda tem prioridade sobre a rotacao por seed', () => {
    const template = pickTrendEditorialTemplate({
      topic: 'Midjourney V8',
      category: 'technology',
      preferredTemplateId: 'anime_hype',
    })

    expect(template.id).toBe('anime_hype')
  })
})
