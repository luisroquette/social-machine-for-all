import { describe, expect, it } from 'vitest'
import { buildTrendEditorialFallback, buildTrendVideoMotionFallback } from './trend-creative'

describe('trend video motion fallback (geracao de video, independente da imagem)', () => {
  it('gera storyboard cinematografico com progressao real e 5 shots, sem nenhum campo de imagem', () => {
    const motion = buildTrendVideoMotionFallback({
      topic: 'Jorge Jesus',
      category: 'sports',
      styleRotation: ['ultrarealista', 'anime'],
      shotsPerVideo: 5,
      shotDurationSec: 3,
    })

    expect(motion.shots).toHaveLength(5)
    expect(motion.shots[0]?.shotId).toBe('shot_1')
    expect(motion.shots[4]?.label).toBe('Payoff')
    expect(new Set(motion.shots.map((shot) => shot.durationSec)).size).toBeGreaterThan(1)
    expect(motion.shots.map((shot) => shot.styleRole)).toEqual([
      'anchor_realism',
      'stylized_burst',
      'abstract_acceleration',
      'cinematic_reveal',
      'premium_payoff',
    ])
    // Slot 2 continua sendo de bucket stylized (anime/stop-motion/graphic-novel);
    // slot 3 abstract; etc. — mas o valor exato varia por seed do tópico (variedade real).
    expect(motion.shots.every((shot) => shot.visualStyle.length > 0)).toBe(true)
    expect(motion.shots.every((shot) => shot.styleDirection.length > 0)).toBe(true)
    expect(motion.shots[0]?.visualIntent).toContain('instante antes do choque')
    expect(motion.shots[2]?.styleDirection.length).toBeGreaterThan(10)
    // cameraMove/lens agora rotacionam por seed do topico dentro do styleRole (variedade real);
    // valor exato nao e mais fixo por categoria+slot.
    expect(motion.shots[0]?.lens.length).toBeGreaterThan(0)
    expect(motion.shots[0]?.cameraMove.length).toBeGreaterThan(0)
    expect(motion.shots[0]?.framing).toContain('diagonal')
    expect(motion.shots[4]?.payoff).toContain('resolucao')
    expect(motion.shots[4]?.rhythm).toContain('longo')
    expect(motion.shots[0]?.motionPrompt).toContain('Sem looping')
    expect(motion.shots[0]?.motionPrompt).toContain('Papel de estilo:')
    expect(motion.shots[0]?.motionPrompt).toContain('Linha editorial:')
    expect(motion.shots[0]?.motionPrompt).toContain('Lente:')
    expect(motion.shots[0]?.motionPrompt).toContain('Payoff final:')

    for (const shot of motion.shots) {
      expect(shot).not.toHaveProperty('imagePrompt')
      expect(shot).not.toHaveProperty('startImagePrompt')
      expect(shot).not.toHaveProperty('endImagePrompt')
      expect(shot).not.toHaveProperty('startMotionPrompt')
      expect(shot).not.toHaveProperty('endMotionPrompt')
    }
  })

  it('REGRESSAO: varia o visualStyle entre topicos diferentes (nao trava sempre no mesmo estilo)', () => {
    // Bug real de producao: 71% dos videos usavam sempre "ultrarealista" porque a rotacao
    // colapsava no fallback fixo. Agora cada slot tem 4 candidatos escolhidos por seed do topico.
    const topics = [
      'GPT 5.6', 'Claude Opus', 'Gemini Ultra', 'DeepSeek R2', 'Llama 4',
      'Midjourney V8', 'Sora 2', 'Runway Gen5', 'Perplexity Pro', 'Grok 4',
      'Copilot X', 'Mistral Large', 'Qwen Max', 'Nano Banana', 'Kling AI',
      'Higgsfield Studio', 'Anthropic MCP', 'OpenAI Agents', 'Meta AI Glasses', 'Apple Intelligence',
    ]
    const byRole: Record<string, Set<string>> = {}
    for (const topic of topics) {
      const motion = buildTrendVideoMotionFallback({
        topic, category: 'technology', styleRotation: ['ultrarealista', 'anime', 'abstrato-cinematic'],
        shotsPerVideo: 5, shotDurationSec: 3,
      })
      for (const shot of motion.shots) {
        byRole[shot.styleRole] = byRole[shot.styleRole] ?? new Set()
        byRole[shot.styleRole].add(shot.visualStyle)
      }
    }
    // Cada slot deve produzir pelo menos 3 estilos distintos ao longo dos 20 topicos.
    for (const [role, styles] of Object.entries(byRole)) {
      expect(styles.size, `slot ${role} deveria variar o estilo, teve: ${[...styles].join(', ')}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('REGRESSAO: varia cameraMove e lens entre topicos diferentes (nao trava sempre no mesmo movimento/lente)', () => {
    // Antes desta mudanca, cameraMove/lens eram fixos por categoria+indice do slot em
    // buildShotBlueprints, entao qualquer topico na mesma categoria gerava o mesmo movimento
    // de camera e lente shot a shot. Agora rotacionam por seed do topico dentro do styleRole.
    const topics = [
      'GPT 5.6', 'Claude Opus', 'Gemini Ultra', 'DeepSeek R2', 'Llama 4',
      'Midjourney V8', 'Sora 2', 'Runway Gen5', 'Perplexity Pro', 'Grok 4',
      'Copilot X', 'Mistral Large', 'Qwen Max', 'Nano Banana', 'Kling AI',
      'Higgsfield Studio', 'Anthropic MCP', 'OpenAI Agents', 'Meta AI Glasses', 'Apple Intelligence',
    ]
    const cameraByRole: Record<string, Set<string>> = {}
    const lensByRole: Record<string, Set<string>> = {}
    for (const topic of topics) {
      const motion = buildTrendVideoMotionFallback({
        topic, category: 'technology', styleRotation: ['ultrarealista', 'anime', 'abstrato-cinematic'],
        shotsPerVideo: 5, shotDurationSec: 3,
      })
      for (const shot of motion.shots) {
        cameraByRole[shot.styleRole] = cameraByRole[shot.styleRole] ?? new Set()
        cameraByRole[shot.styleRole].add(shot.cameraMove)
        lensByRole[shot.styleRole] = lensByRole[shot.styleRole] ?? new Set()
        lensByRole[shot.styleRole].add(shot.lens)
      }
    }
    for (const [role, moves] of Object.entries(cameraByRole)) {
      expect(moves.size, `slot ${role} deveria variar o cameraMove, teve: ${[...moves].join(', ')}`).toBeGreaterThanOrEqual(3)
    }
    for (const [role, lenses] of Object.entries(lensByRole)) {
      expect(lenses.size, `slot ${role} deveria variar a lens, teve: ${[...lenses].join(', ')}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('REGRESSAO: varia subjectAction/environmentAction entre topicos da mesma categoria (narrativa nao trava sempre no mesmo texto)', () => {
    // Antes desta mudanca, subjectAction/environmentAction vinham 100% fixos de
    // buildShotBlueprints por categoria+slot — qualquer topico de "technology" gerava o
    // mesmissimo texto narrativo. Agora ha uma variante alternativa por seed do topico.
    const topics = [
      'GPT 5.6', 'Claude Opus', 'Gemini Ultra', 'DeepSeek R2', 'Llama 4',
      'Midjourney V8', 'Sora 2', 'Runway Gen5', 'Perplexity Pro', 'Grok 4',
      'Copilot X', 'Mistral Large', 'Qwen Max', 'Nano Banana', 'Kling AI',
      'Higgsfield Studio', 'Anthropic MCP', 'OpenAI Agents', 'Meta AI Glasses', 'Apple Intelligence',
    ]
    const subjectByRole: Record<string, Set<string>> = {}
    for (const topic of topics) {
      const motion = buildTrendVideoMotionFallback({
        topic, category: 'technology', styleRotation: ['ultrarealista', 'anime', 'abstrato-cinematic'],
        shotsPerVideo: 5, shotDurationSec: 3,
      })
      for (const shot of motion.shots) {
        subjectByRole[shot.styleRole] = subjectByRole[shot.styleRole] ?? new Set()
        subjectByRole[shot.styleRole].add(shot.subjectAction)
      }
    }
    for (const [role, actions] of Object.entries(subjectByRole)) {
      expect(actions.size, `slot ${role} deveria variar o subjectAction, teve: ${[...actions].join(' | ')}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('REGRESSAO: varia a curva de ritmo (proporcao de duracao entre shots) entre topicos diferentes', () => {
    // Antes desta mudanca havia um UNICO padrao de multiplicadores de duracao por quantidade
    // de shots — todo video tinha exatamente a mesma "forma" de pacing, so a duracao base
    // mudava. Agora ha 3 curvas por seed do topico.
    const topics = [
      'GPT 5.6', 'Claude Opus', 'Gemini Ultra', 'DeepSeek R2', 'Llama 4',
      'Midjourney V8', 'Sora 2', 'Runway Gen5', 'Perplexity Pro', 'Grok 4',
    ]
    const shapes = new Set<string>()
    for (const topic of topics) {
      const motion = buildTrendVideoMotionFallback({
        topic, category: 'technology', styleRotation: ['ultrarealista'], shotsPerVideo: 5, shotDurationSec: 4,
      })
      shapes.add(motion.shots.map((shot) => shot.durationSec).join(','))
    }
    expect(shapes.size, `curvas de ritmo deveriam variar, teve: ${[...shapes].join(' | ')}`).toBeGreaterThanOrEqual(2)
  })
})

describe('trend editorial fallback (geracao de capa/legenda, independente do video)', () => {
  it('gera hook/capa/legenda e um imagePrompt dedicado de capa, sem depender de nenhum shot', () => {
    const editorial = buildTrendEditorialFallback({
      topic: 'Jorge Jesus',
      category: 'sports',
      defaultCta: 'Comente PROMPT.',
    })

    expect(editorial.hookCandidates.length).toBeGreaterThanOrEqual(5)
    expect(editorial.coverCandidates.length).toBeGreaterThanOrEqual(4)
    expect(editorial.editorialTemplateId).toBe('futebol_absurdo')
    expect(editorial.editorialTemplateLabel).toBe('Futebol absurdo')
    expect(editorial.hookCandidates).toContain(editorial.hookTitle)
    expect(editorial.coverCandidates).toContain(editorial.coverTitle)
    expect(editorial.hookTitle).not.toContain('ESTA BOMBANDO')
    expect(editorial.imagePrompt).toContain('capa/thumbnail')
    expect(editorial.imagePrompt).toContain('Linha editorial: Futebol absurdo.')
  })

  it('usa o topico refinado para fugir de seed generico', () => {
    const editorial = buildTrendEditorialFallback({
      topic: 'GPT-5.6 Sol Terra Luna',
      category: 'technology',
      defaultCta: 'Comente PROMPT.',
    })

    expect(editorial.hookTitle).toContain('GPT-5.6')
    expect(editorial.coverTitle).toContain('GPT-5.6')
    expect(editorial.caption).toContain('GPT-5.6')
  })

  it('REGRESSAO: varia a estrutura da caption entre topicos (nao repete sempre a mesma frase fixa)', () => {
    // Antes desta mudanca, caption era sempre "{topic} esta dominando as buscas no Brasil
    // agora. {cta}" — identica para qualquer topico/categoria. Agora ha 4 estruturas de
    // frase por categoria, escolhidas por seed do topico.
    const topics = [
      'GPT 5.6', 'Claude Opus', 'Gemini Ultra', 'DeepSeek R2', 'Llama 4',
      'Midjourney V8', 'Sora 2', 'Runway Gen5', 'Perplexity Pro', 'Grok 4',
    ]
    const captionShapes = new Set<string>()
    for (const topic of topics) {
      const editorial = buildTrendEditorialFallback({ topic, category: 'technology', defaultCta: 'Comente PROMPT.' })
      captionShapes.add(editorial.caption.replace(topic, '{topic}'))
    }
    expect(captionShapes.size, `captions deveriam variar de estrutura, teve: ${[...captionShapes].join(' | ')}`).toBeGreaterThanOrEqual(3)
  })
})
