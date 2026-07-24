/**
 * Article Writer — generates long-form X Articles (~2500 words)
 * from the best curated content of the day.
 *
 * Flow:
 * 1. Loads top curated content (highest relevance, most recent)
 * 2. Groups by trending topic
 * 3. Generates a comprehensive article combining multiple sources
 * 4. Saves as generated_content with target_format='article'
 * 5. Sends formatted article to Telegram for manual X publish
 */

import { generateSimpleText } from '@/lib/ai/tool-loop'
import { getAdminClient } from '@/lib/supabase/admin'

interface ArticleResult {
  success: boolean
  title: string
  wordCount: number
  sourceCount: number
  tokensUsed: number
  articleId?: string
}

const ARTICLE_SYSTEM_PROMPT = `Voce e um escritor tecnico de elite especializado em inteligencia artificial.
Seu trabalho e criar ARTIGOS LONGOS (1500-2500 palavras) para publicacao no X (Twitter Articles).

## Estilo:
- Analise profunda e tecnica, nao superficial
- Dados concretos, benchmarks, comparacoes
- Tom: especialista ensinando — autoritativo mas acessivel
- Portugues brasileiro com termos tecnicos em ingles
- Estrutura clara com headers, bullet points, secoes

## Estrutura obrigatoria:
1. TITULO: provocativo, especifico, com dado (max 100 chars)
2. HOOK: primeiro paragrafo que prende a atencao (2-3 frases)
3. CONTEXTO: o que esta acontecendo e por que importa
4. ANALISE: mergulho tecnico com dados, comparacoes, benchmarks
5. IMPLICACOES: o que isso significa na pratica
6. CONCLUSAO: takeaway principal + provocacao para discussao

## Regras:
- SEMPRE cite as fontes (autores, links quando disponivel)
- Use dados concretos do conteudo fornecido — nao invente numeros
- Cada secao deve ter pelo menos 2-3 paragrafos substanciais
- Inclua bullet points para dados comparativos
- Faca transicoes naturais entre secoes
- Termine com uma pergunta provocativa para gerar discussao

## Formato de resposta:
Retorne APENAS JSON:
{
  "title": "Titulo do artigo (max 100 chars)",
  "content": "Artigo completo em Markdown com ## headers, **bold**, bullet points, etc.",
  "summary": "Resumo em 1-2 frases para preview (max 280 chars)"
}
`

export async function generateArticle(
  workspaceId: string,
  model: string,
): Promise<ArticleResult> {
  const supabase = getAdminClient()

  // 1. Load best curated content from last 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: curatedContent } = await supabase
    .from('curated_content')
    .select('source_content, source_author, source_url, relevance_score, topic_id')
    .eq('workspace_id', workspaceId)
    .gte('created_at', oneDayAgo)
    .order('relevance_score', { ascending: false })
    .limit(15)

  if (!curatedContent?.length) {
    return { success: false, title: '', wordCount: 0, sourceCount: 0, tokensUsed: 0 }
  }

  // 2. Load trending topics for context
  const topicIds = [...new Set(curatedContent.map((c: Record<string, unknown>) => c.topic_id).filter((id): id is string => typeof id === 'string'))]
  const { data: topics } = await supabase
    .from('trending_topics')
    .select('id, title, description')
    .in('id', topicIds)

  const topicMap: Record<string, { title: string; description: string }> = {}
  for (const t of (topics ?? []) as Array<Record<string, unknown>>) {
    topicMap[t.id as string] = { title: t.title as string, description: (t.description as string) ?? '' }
  }

  // 3. Build source material for the article
  const sourceMaterial = (curatedContent as Array<Record<string, unknown>>).map((c, i) => {
    const topic = topicMap[c.topic_id as string]
    return [
      `### Fonte ${i + 1}:`,
      topic ? `Tema: ${topic.title}` : '',
      `Autor: @${c.source_author ?? 'unknown'}`,
      c.source_url ? `Link: ${c.source_url}` : '',
      `Conteudo: ${c.source_content}`,
      '',
    ].filter(Boolean).join('\n')
  }).join('\n')

  // 4. Generate article
  const userMessage = [
    `Gere um artigo longo (1500-2500 palavras) baseado nestas ${curatedContent.length} fontes sobre IA/tech:`,
    '',
    sourceMaterial,
    '',
    'Combine as fontes num artigo coeso. Cite os autores. Nao invente dados.',
    'JSON: {"title": "...", "content": "markdown completo...", "summary": "max 280 chars"}',
  ].join('\n')

  const result = await generateSimpleText({
    model,
    systemPrompt: ARTICLE_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 8000,
    temperature: 0.7,
  })

  // 5. Parse response
  let article: { title: string; content: string; summary: string }
  try {
    const cleaned = result.text.replace(/```json?\n?|\n?```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    article = JSON.parse(jsonMatch?.[0] ?? cleaned)
  } catch {
    return { success: false, title: 'Parse error', wordCount: 0, sourceCount: curatedContent.length, tokensUsed: result.tokensUsed }
  }

  const wordCount = article.content.split(/\s+/).length

  // 6. Save to generated_content
  const { data: saved } = await supabase
    .from('generated_content')
    .insert({
      workspace_id: workspaceId,
      target_platform: 'x',
      target_format: 'article',
      content: article.content,
      model_used: model,
      status: 'approved', // Articles skip reviewer — go straight to manual publish
    })
    .select('id')
    .single()

  return {
    success: true,
    title: article.title,
    wordCount,
    sourceCount: curatedContent.length,
    tokensUsed: result.tokensUsed,
    articleId: (saved?.id as string) ?? undefined,
  }
}
