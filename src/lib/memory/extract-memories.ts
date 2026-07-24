import { generateSimpleText } from '@/lib/ai/tool-loop'
import type { AgentResult } from '@/lib/agents/agent-types'

export interface ExtractedMemory {
  category: 'insight' | 'pattern' | 'preference' | 'warning'
  content: string
  shared: boolean
}

/**
 * Use AI to extract operational memories from agent execution results.
 * Uses deepseek-chat for cost efficiency.
 */
export async function extractMemoriesFromResult(
  agentSlug: string,
  result: AgentResult
): Promise<ExtractedMemory[]> {
  // Skip if no meaningful work was done
  if (!result.success || (result.itemsProcessed === 0 && result.itemsProduced === 0)) {
    return []
  }

  const systemPrompt = [
    'Voce analisa resultados de execucao de agentes IA e extrai memorias operacionais.',
    'Retorne um JSON array com memorias uteis. Cada memoria tem:',
    '- category: "insight" | "pattern" | "preference" | "warning"',
    '- content: texto curto e objetivo da memoria (max 200 chars)',
    '- shared: true se a memoria e util para OUTROS agentes tambem',
    '',
    'Regras:',
    '- So extraia observacoes genuinamente uteis para execucoes futuras',
    '- Retorne [] se nada notavel aconteceu',
    '- Maximo 3 memorias por execucao',
    '- Seja especifico com dados (numeros, nomes, metricas)',
    '- Responda APENAS com o JSON array, sem markdown ou explicacao',
  ].join('\n')

  const userMessage = [
    `Agente: ${agentSlug}`,
    `Sucesso: ${result.success}`,
    `Processados: ${result.itemsProcessed}`,
    `Produzidos: ${result.itemsProduced}`,
    `Erros: ${result.errors.join(', ') || 'nenhum'}`,
    `Duracao: ${(result.durationMs / 1000).toFixed(1)}s`,
    `Detalhes: ${JSON.stringify(result.details).slice(0, 1500)}`,
  ].join('\n')

  try {
    const { text } = await generateSimpleText({
      model: 'deepseek-chat',
      systemPrompt,
      userMessage,
      maxTokens: 512,
      temperature: 0.3,
    })

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    if (!Array.isArray(parsed)) return []

    // Validate and sanitize
    return parsed
      .filter(
        (m: any) =>
          typeof m.content === 'string' &&
          m.content.length > 0 &&
          ['insight', 'pattern', 'preference', 'warning'].includes(m.category)
      )
      .slice(0, 3)
      .map((m: any) => ({
        category: m.category,
        content: m.content.slice(0, 200),
        shared: m.shared === true,
      }))
  } catch (err) {
    console.error(`[memory] Failed to extract memories for ${agentSlug}:`, err instanceof Error ? err.message : err)
    return []
  }
}
