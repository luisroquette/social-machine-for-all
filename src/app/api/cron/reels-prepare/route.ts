import { WORKSPACE_ID } from '@/lib/config/constants'
export const maxDuration = 300

import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { createHash } from 'crypto'
import { generateStoredImage } from '@/lib/ai/openai-image'
import { generateTextWithFallback, aiSentinelCode, AI_SENTINEL } from '@/lib/ai/generate-with-fallback'
import { transcribeVideo } from '@/lib/reels/transcribe-video'
import { pickFollowCtaAngle } from '@/lib/reels/follow-cta'

const REEL_RENDERER_URL = process.env.REEL_RENDERER_URL || ''
const REEL_RENDERER_API_KEY = process.env.REEL_RENDERER_API_KEY || ''

/**
 * PHASE 1 of Reel pipeline: Prepare content.
 * Download video + transcribe + translate + generate cover.
 * Saves everything to generated_content with status='reel_ready'.
 * Phase 2 (reels-publish) picks up and renders with Remotion.
 *
 * Processes up to QUEUE_CAP items per run (filling the buffer in one shot).
 */
const QUEUE_CAP = 10
const TIME_BUDGET_MS = 240_000 // 240s — leave 60s buffer within maxDuration=300

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await _run(request)
  } catch (topErr) {
    const msg = topErr instanceof Error ? topErr.message : String(topErr)
    const stack = topErr instanceof Error ? topErr.stack?.slice(0, 500) : ''
    console.error('[reels-prepare] TOP-LEVEL CRASH:', msg, stack)
    Sentry.captureException(topErr, { tags: { cron: 'reels-prepare', step: 'top_level' } })
    return NextResponse.json({ error: 'internal', message: msg }, { status: 500 })
  }
}

async function _run(_request: Request) {
  // Reach-based pauses are handled by the C1 monitor instead of a fixed
  // calendar pause. See anti-shadowban-phase3.regression.test.ts.

  const aiKeywordsPattern = await getVariable(WORKSPACE_ID, 'ai_keywords_pattern')
  const minRelevanceScore = await getNumericVariable(WORKSPACE_ID, 'reel_min_relevance_score')
  const lookbackHours = await getNumericVariable(WORKSPACE_ID, 'reel_lookback_hours')
  const candidateLimit = await getNumericVariable(WORKSPACE_ID, 'reel_candidate_limit')
  const instagramHandle = await getVariable(WORKSPACE_ID, 'instagram_handle')
  const twitterHandle = await getVariable(WORKSPACE_ID, 'twitter_handle')
  const referenceStyleAccount = await getVariable(WORKSPACE_ID, 'reference_style_account')
  const reelPrepModel = await getVariable(WORKSPACE_ID, 'reel_prep_model')
  const reelPrepMaxTokens = await getNumericVariable(WORKSPACE_ID, 'reel_prep_max_tokens')
  const videoFps = await getNumericVariable(WORKSPACE_ID, 'reel_video_fps')

  const AI_KEYWORDS = new RegExp(aiKeywordsPattern, 'i')

  const supabase = getAdminClient()

  // ── Reset expired AI sentinels before querying (TTLs: 4h rate_limited, 2h unavailable) ──
  // cleanup-storage runs daily — reset inline so items unlock within their TTL window.
  await supabase
    .from('curated_content')
    .update({ skip_reason: null, skip_until: null })
    .eq('workspace_id', WORKSPACE_ID)
    .in('skip_reason', [AI_SENTINEL.RATE_LIMITED, AI_SENTINEL.UNAVAILABLE, AI_SENTINEL.PUBLISH_FAILED])
    .lt('skip_until', new Date().toISOString())

  // ── Find AI/tech video tweet (dedicated video query) ──
  const twoDaysAgo = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()

  const { data: candidates } = await supabase
    .from('curated_content')
    .select('id, source_url, source_content, source_author, relevance_score, source_metrics')
    .eq('workspace_id', WORKSPACE_ID)
    .in('status', ['curated', 'written'])
    .not('source_url', 'is', null)
    .gte('created_at', twoDaysAgo)
    .contains('source_metrics', { media_types: ['video'] })
    .gte('relevance_score', minRelevanceScore)
    // Exclude items temporarily skipped due to AI rate-limit or outage sentinels
    .or(`skip_reason.is.null,skip_reason.not.in.(${AI_SENTINEL.RATE_LIMITED},${AI_SENTINEL.UNAVAILABLE},${AI_SENTINEL.PUBLISH_FAILED})`)
    .order('created_at', { ascending: false })
    .order('relevance_score', { ascending: false })
    .limit(candidateLimit)

  if (!candidates?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_video_content' })
  }

  type C = typeof candidates[0]
  const videoItems = candidates.filter((c: C) => {
    const text = c.source_content || ''
    // Must match AI keywords
    if (!AI_KEYWORDS.test(text)) return false
    // Must have substantial text (not just "Every X user right now" meme tweets)
    const cleanText = text.replace(/https?:\/\/\S+/g, '').replace(/@\w+/g, '').trim()
    if (cleanText.length < 60) return false
    return true
  })

  if (!videoItems.length) {
    return NextResponse.json({ ok: true, skipped: 'no_ai_video', total: candidates.length })
  }

  // ── Railway warmup — send ping early so service is warm when we reach the item loop ──
  // Railway spins down after ~5min of inactivity and returns 5xx on first request.
  // We fire a /health GET here, then continue with DB work while Railway wakes up.
  const railwayWarmupStart = Date.now()
  let railwayReady = false
  try {
    const warmRes = await fetch(`${REEL_RENDERER_URL}/health`, {
      headers: { Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
      signal: AbortSignal.timeout(15_000),
    })
    railwayReady = warmRes.ok
    console.log(`[reels-prepare] Railway warmup: ${warmRes.status} (${Date.now() - railwayWarmupStart}ms)`)
    if (!warmRes.ok) {
      // Service is cold — wait 10s and retry once
      await new Promise(r => setTimeout(r, 10_000))
      const retryRes = await fetch(`${REEL_RENDERER_URL}/health`, {
        headers: { Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
        signal: AbortSignal.timeout(20_000),
      })
      railwayReady = retryRes.ok
      console.log(`[reels-prepare] Railway warmup retry: ${retryRes.status} (${Date.now() - railwayWarmupStart}ms total)`)
    }
  } catch (warmErr) {
    console.warn('[reels-prepare] Railway warmup failed (will still try direct URLs):', warmErr instanceof Error ? warmErr.message : warmErr)
  }

  // ── Helper: upload video buffer to Supabase Storage ──
  const uploadAndGetUrl = async (rawUrl: string, itemId: string): Promise<string> => {
    try {
      const vidRes = await fetch(rawUrl, { signal: AbortSignal.timeout(60_000) })
      if (vidRes.ok) {
        // Guard against OOM on large videos (4K Twitter videos can be 200-500MB).
        // Buffer.from(arrayBuffer) allocates 2x video size — fatal on 1GB serverless limit.
        const contentLength = parseInt(vidRes.headers.get('content-length') || '0', 10)
        if (contentLength > 50_000_000) {
          await vidRes.body?.cancel().catch(() => {})
          console.log(`[reels-prepare] Video ${Math.round(contentLength / 1e6)}MB — known large, using direct URL`)
          return rawUrl
        }

        // content-length = 0 means Twitter CDN didn't send the header (common).
        // Use streaming with 50MB hard cap to prevent OOM instead of blindly calling arrayBuffer().
        let vidBuffer: Buffer
        if (contentLength > 0) {
          vidBuffer = Buffer.from(await vidRes.arrayBuffer())
        } else {
          const MAX = 50_000_000
          const reader = vidRes.body?.getReader()
          if (!reader) return rawUrl
          const chunks: Uint8Array[] = []
          let total = 0
          let tooLarge = false
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            total += value.byteLength
            if (total > MAX) {
              await reader.cancel().catch(() => {})
              console.log(`[reels-prepare] Video >50MB (no content-length) — using direct URL`)
              tooLarge = true
              break
            }
            chunks.push(value)
          }
          if (tooLarge) return rawUrl
          vidBuffer = Buffer.concat(chunks.map(c => Buffer.from(c)))
        }

        const storagePath = `downloads/${itemId}.mp4`
        const { error: uploadError } = await supabase.storage
          .from('reels')
          .upload(storagePath, vidBuffer, { contentType: 'video/mp4', upsert: true })
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('reels').getPublicUrl(storagePath)
          return urlData.publicUrl
        }
        Sentry.captureException(new Error(uploadError.message), { tags: { cron: 'reels-prepare', step: 'supabase_upload' } })
        console.error('[reels-prepare] Supabase upload failed:', uploadError.message)
      }
    } catch (uploadErr) {
      Sentry.captureException(uploadErr, { tags: { cron: 'reels-prepare', step: 'supabase_upload' } })
      console.error('[reels-prepare] Video storage error:', uploadErr instanceof Error ? uploadErr.message : uploadErr)
    }
    return rawUrl
  }

  // ── Process multiple items — fill queue up to QUEUE_CAP ──
  const prepared: string[] = []
  const skippedReasons: string[] = []
  const usedIds = new Set<string>()
  const runStart = Date.now()

  // How many slots to fill: QUEUE_CAP minus items already reel_ready
  const { count: existingReady, error: qErr1 } = await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_format', 'reel')
    .eq('status', 'reel_ready')
  if (qErr1) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`reels-prepare generated_content.reel_ready: ${qErr1.message}`), { tags: { cron: 'reels-prepare', step: 'db_query_guard' } })
  }
  const slotsToFill = Math.max(0, QUEUE_CAP - (existingReady ?? 0))

  if (slotsToFill === 0) {
    return NextResponse.json({ ok: true, skipped: 'queue_full', existingReady })
  }

  for (const v of videoItems) {
    if (prepared.length >= slotsToFill) break
    if (Date.now() - runStart > TIME_BUDGET_MS) {
      console.warn('[reels-prepare] Time budget reached — stopping early')
      break
    }

    try {
    // Dedup: already has a reel or processed in this run
    // IMPORTANT: exclude failed items so they can be retried (same fix as reels-prepare-brand)
    if (usedIds.has(v.id)) { skippedReasons.push(`${v.source_author}:usedIds`); continue }
    const { count, error: qErr2 } = await supabase
      .from('generated_content')
      .select('*', { count: 'exact', head: true })
      .eq('curated_content_id', v.id)
      .eq('target_format', 'reel')
      .not('status', 'eq', 'failed') // allow retrying failed items
  if (qErr2) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`reels-prepare generated_content.recent_by_source: ${qErr2.message}`), { tags: { cron: 'reels-prepare', step: 'db_query_guard' } })
  }
    if ((count ?? 0) > 0) { skippedReasons.push(`${v.source_author}:dedup(${count})`); continue }

    // ── Download video ──
    let videoUrl = ''
    const metrics = v.source_metrics as Record<string, unknown> | null
    const directVideoUrl = typeof metrics?.video_url === 'string' ? metrics.video_url : null
    if (!directVideoUrl) skippedReasons.push(`${v.source_author}:no_video_url(metrics=${JSON.stringify(metrics)?.slice(0,80)})`)

    if (directVideoUrl) {
      const stored = await uploadAndGetUrl(directVideoUrl, v.id)
      if (stored) {
        // If uploadAndGetUrl returned a direct Twitter URL, the video is too large (4K+).
        // Instagram and Railway can't process it — mark as rejected to stop reprocessing.
        if (stored.includes('twimg.com')) {
          skippedReasons.push(`${v.source_author}:twimg_large(${stored.slice(0,60)})`)
          console.log(`[reels-prepare] Rejecting ${v.id} — large video (>50MB), twimg URL unreliable for Railway/IG`)
          await supabase.from('curated_content')
            .update({ status: 'rejected' })
            .eq('id', v.id)
          continue
        }
        videoUrl = stored
      }
    }

    if (!videoUrl) {
      skippedReasons.push(`${v.source_author}:no_videoUrl(directVideoUrl=${directVideoUrl?.slice(0,40)})`)
      console.log(`[reels-prepare] Download failed for ${v.source_author}, skipping`)
      continue
    }

    // ── Transcribe (com timeout — ver transcribe-video.ts) ──
    // Sem timeout, um /transcribe travado matava a função inteira (maxDuration)
    // e travava a produção de reels permanentemente (item-veneno reprocessado).
    const { srtText, fullText } = await transcribeVideo(
      REEL_RENDERER_URL,
      REEL_RENDERER_API_KEY,
      videoUrl,
      v.source_content,
    )

  // Ângulo rotativo de follow-CTA (razão concreta pra seguir, varia por post) — ver follow-cta.ts
  const followCta = pickFollowCtaAngle()

  // ── AI: translate + hook + caption ──
  const aiText = await generateTextWithFallback({
    primary: (reelPrepModel ?? '').startsWith('gemini') ? 'gemini' : 'deepseek',
    system: `CONTEXTO: Voce e o copywriter senior do ${instagramHandle} — perfil de Instagram sobre IA e tecnologia. Estude o estilo do ${referenceStyleAccount} como referencia absoluta.`,
    prompt: `

DATA ATUAL: ${new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' })} (${new Date().getFullYear()}). NUNCA mencione anos anteriores a 2026 como se fossem atuais.

TAREFA 1: ${srtText ? `TRADUZIR SRT para PT-BR (manter timestamps):\n${srtText}` : 'Sem SRT.'}

TAREFA 2: Titulo da capa — ESTILO ${referenceStyleAccount}:

O titulo NAO e um resumo curto. E uma MANCHETE JORNALISTICA completa que conta a historia.

EXEMPLOS do ${referenceStyleAccount} (copie este estilo EXATO):
- "JACK DORSEY AND ROELOF BOTHA THINK AI CAN MAKE MIDDLE MANAGEMENT OBSOLETE"
- "GOOGLE DEEPMIND JUST HIRED A PHILOSOPHER TO PREPARE FOR AGI AND AI CONSCIOUSNESS"
- "OVER 40M APPS HAVE BEEN BUILT WITH LOVABLE. THESE ARE THE 6 MOST SUCCESSFUL ONES"

EXEMPLOS DE ESTILO (dados sao ficticios — use para estrutura, nao para conteudo):
- "[EMPRESA/PESSOA DO TWEET] [VERBO DE ACAO] [O QUE ACONTECEU SEGUNDO O TWEET]"
- "[DADO ESPECIFICO DO TWEET]. [IMPLICACAO LOGICA DIRETA]"

REGRAS do hookTitle (ESTILO POPULISTA — escreva para quem conhece ChatGPT mas nunca ouviu falar de RAG ou LoRA):

REGRA 1 — NOME OBSCURO = PROIBIDO NO TITULO
Se o tweet fala de ferramenta/produto que o publico geral nao conhece: NUNCA use o nome.
Descreva O QUE ELA FAZ em linguagem de todo dia.
❌ "DILOCO PERMITE TREINAR IA SEM PARAR QUANDO CHIPS FALHAM"
✅ "COMO UMA IA CONTINUA APRENDENDO MESMO QUANDO OS COMPUTADORES FALHAM"
❌ "HERMES VAULT V0.4.0 ADICIONA OBSERVABILIDADE PARA AGENTES DE IA"
✅ "A FERRAMENTA QUE MOSTRA O QUE SEUS AGENTES DE IA ESTAO FAZENDO"

REGRA 2 — MARCA CONHECIDA = USE O NOME (cria autoridade)
OpenAI, Google, Apple, Meta, Microsoft, Elon Musk, Sam Altman, Anthropic → use o nome.
✅ "O GOOGLE LANCOU UMA IA QUE ESCREVE CODIGO SEM VOCE DIGITAR NADA"
✅ "OPENAI ACABA DE MUDAR COMO O CHATGPT ENTENDE IMAGENS"

REGRA 3 — FORMATOS QUE GERAM CLIQUE (use variacao, nao repita sempre o mesmo):
- Pergunta: "VOCE SABIA QUE O CHATGPT CONSEGUE FAZER ISSO?"
- Revelacao: "A IA QUE ESTA SUBSTITUINDO [funcao que todo mundo conhece]"
- Curiosidade: "O METODO QUE A OPENAI USA E NINGUEM FALA SOBRE"
- Impacto no leitor: "COMO USAR O GEMINI PARA [tarefa do dia a dia]"
- Novidade direta: "O GOOGLE ACABA DE LANCAR [descricao acessivel]"

REGRA 4 — TECNICO SO COM ANGULO HUMANO
Se o assunto e inevitavelmente tecnico, traduza para impacto na vida real.
❌ "NOVO BENCHMARK MOSTRA GPT-5 SUPERANDO CLAUDE EM RACIOCINIO LOGICO"
✅ "QUAL A IA MAIS INTELIGENTE DO MUNDO AGORA? O RESULTADO SURPREENDE"

- 60-90 chars, PT-BR, MAIUSCULAS
- highlightWords: marcas conhecidas + verbos de acao/impacto (3-4 palavras para vermelho)
- highlightClause: o trecho CONTIGUO mais chocante/quantificavel do hookTitle (2-6 palavras, COPIADO LITERALMENTE do hookTitle — dado numerico, consequencia ou fato forte). Ex: hookTitle "TURISTA E ARREMESSADO 2,4 METROS NO AR POR BISAO" → highlightClause "2,4 METROS NO AR". Sera destacado em vermelho no video.
- subtitle: 30-40 chars, diga O QUE e a tecnologia — nao repita o nome tecnico

TAREFA 3: Caption — ESTILO VIRAL Instagram (NAO lista de features):

ESTRUTURA NARRATIVA RECOMENDADA — lapidar sem mudar a voz atual:
1. COLD OPEN: primeira linha com ruptura, dado ou consequencia que para o scroll.
2. STAKES: explique por que isso importa agora para quem usa, compra ou trabalha com IA.
3. PAYOFF: entregue o fato principal com detalhe concreto do tweet.
4. TURN: mostre a virada/insight nao obvio ("o ponto real e...").
5. TAKEAWAY: feche com uma frase memoravel antes do CTA.
Use essa estrutura como trilho invisivel. Nao escreva labels como "Cold open" ou "Takeaway".

EXEMPLOS DE CAPTIONS VIRAIS (copie este padrao):

Exemplo 1: "A OpenAI acabou de fazer algo que ninguem esperava. Sam Altman anunciou que o ChatGPT agora consegue [FATO ESPECIFICO]. Isso muda completamente o jogo pra quem trabalha com [AREA].

O que pouca gente percebeu e que isso significa [CONSEQUENCIA REAL]. Enquanto todo mundo foca em [OBVIO], o verdadeiro impacto esta em [INSIGHT NAO OBVIO].

Se voce trabalha com IA, precisa prestar atencao nisso agora. Salva esse post.

Eu testo essas ferramentas em producao e mostro o que funciona de verdade — segue o ${instagramHandle} pra receber a IA do dia sem hype."

Exemplo 2: "Isso aqui vai mudar a forma como voce usa IA no dia a dia. [NOME] acabou de lancar [PRODUTO/FEATURE] e o resultado e impressionante.

Testei e posso dizer: [BENEFICIO CONCRETO]. A diferenca pro que existia antes e absurda — [COMPARACAO ESPECIFICA].

Comenta 'LINK' que eu te mando o acesso direto."

REGRAS DA CAPTION:
- GANCHO na primeira linha (frase que PARA o scroll)
- Conte a NOTICIA como se estivesse contando pro amigo mais inteligente que voce conhece
- Paragrafos de 2-3 linhas, fluidos, narrativa envolvente
- FOMO: faca o leitor sentir que PRECISA saber disso
- CTA de engajamento: "Salva esse post", "Comenta LINK", pergunta polemica
- FECHAMENTO OBRIGATORIO — CTA de SEGUIR ${instagramHandle}: termine a caption convidando a pessoa a seguir, usando ESTE ANGULO especifico: "${followCta.angle}"
  REGRAS do CTA de seguir: dê uma RAZAO concreta pra seguir (nunca "siga pra mais conteudo" generico); soe natural, na voz do perfil; 1-2 frases; inclua "${instagramHandle}".
- DEPOIS do CTA de seguir, incluir: "Acompanhe tambem no X/Twitter: x.com/${twitterHandle}"
- 5-8 hashtags estrategicas (mix de grandes + nicho)
- Minimo 150 palavras na caption (captions longas performam melhor no IG)
- PROIBIDO: bullet points, listas secas, emojis excessivos, tom de press release, frases de bot

TWEET ORIGINAL (fonte de verdade — NAO invente):
${v.source_content}

TRANSCRICAO (para SRT, nao para caption):
${fullText.slice(0, 500)}

REGRA: caption FIEL ao tweet. NAO invente fatos.

TAREFA 4: imagePrompt (ingles, 9:16) — cena cinematica UNICA para este tweet especifico:

PROCESSO OBRIGATORIO — siga os 3 passos:

PASSO 1 — Identifique o ELEMENTO MAIS VISUAL do tweet:
Qual e o objeto, acao ou contraste mais forte que o tweet descreve?
Exemplos: "robo fisico andando", "chip processando 1 trilhao de parametros", "engenheiro demitido por IA", "dashboard mostrando $96K economizados"

PASSO 2 — Crie uma cena cinematica ESPECIFICA para esse elemento:
A cena deve ser reconhecivel APENAS para este tweet. Se trocar o tweet, a imagem nao faz sentido.
PROIBIDO: imagens que serviriam para qualquer tweet de IA (dashboard generico, cerebro digital, servidor sem contexto)
OBRIGATORIO: referenciar algo concreto do tweet — numero especifico, empresa real, objeto fisico, acao descrita

PASSO 3 — Adicione qualidade cinematica com cores vibrantes:
- Iluminacao dramatica com cores ricas (neon, vibrant, high contrast)
- Angulo cinematico (close-up extremo, perspectiva de baixo, wide shot impactante)
- Paleta de cores especifica (ex: "electric blue and magenta", "neon green on black", "warm amber and deep purple")
- Ultra photorealistic ou high-end CGI render

EXEMPLOS DE imagePrompt CORRETOS (especificos ao tweet):
- Tweet sobre "empresario gastou $96K em agencia": "crumpled stack of invoices labeled $96,000 dissolving into glowing AI interface completing the task in seconds, electric blue and gold contrast, cinematic macro shot"
- Tweet sobre "Google lanca modelo 2x mais rapido": "Google's DeepMind logo glowing in electric blue, neural network accelerating with motion blur, speed lines in vivid cyan and white, dramatic perspective"
- Tweet sobre "robo da Figure aprendeu a andar": "humanoid robot legs taking first steps on metallic floor, dramatic rim lighting in orange and blue, low angle cinematic shot, ultra photorealistic"
- Tweet sobre "Claude integrado ao Blender": "3D wireframe geometric shapes being sculpted by glowing AI cursors inside Blender interface, vibrant orange grid lines on deep blue background"

SE o tweet mencionar UMA PESSOA REAL pelo nome: "confident [male/female] professional in [contexto do tweet], dramatic portrait lighting, vibrant rim light" (SEM nome real)

FORMATO: imagePrompt em ingles, 40-70 palavras, especifico e cinematico.

JSON: {"srt_ptbr":"...", "hookTitle":"...", "highlightWords":["..."], "highlightClause":"...", "subtitle":"...", "caption":"...", "imagePrompt":"..."}`,
    maxOutputTokens: Math.round((reelPrepMaxTokens || 2000) * (0.85 + Math.random() * 0.30)), // B3: ±15% variation
  })
    const match = aiText.match(/\{[\s\S]*\}/)
    if (!match) {
      skippedReasons.push(`${v.source_author}:no_json(ai="${aiText.slice(0,120).replace(/\n/g,' ')}")`)
      console.error(`[reels-prepare] No JSON from Claude for ${v.id}:`, aiText.slice(0, 200))
      continue
    }

    let meta: { srt_ptbr: string; hookTitle: string; highlightWords: string[]; highlightClause?: string; subtitle: string; caption: string; imagePrompt?: string }
    try {
      meta = JSON.parse(match[0])
    } catch {
      console.error(`[reels-prepare] Malformed JSON from Claude for ${v.id}`)
      continue
    }

    const rawImagePrompt = typeof meta.imagePrompt === 'string' && meta.imagePrompt.trim().length >= 20
      ? meta.imagePrompt.trim()
      : null

    const FALLBACK_IMAGE_PROMPT = (() => {
      const src = (v.source_content || '').toLowerCase()
      if (/\b(gpu|nvidia|chip|silicon|hardware|processor|tpu)\b/.test(src))
        return 'extreme close-up of GPU die with glowing neon-green circuits, vibrant emerald and white light emanating from silicon wafer, rich color contrast'
      if (/\b(robot|robotic|humanoid|physical ai|embodied)\b/.test(src))
        return 'humanoid robot hand touching holographic blue-purple interface, electric blue and violet glow, dramatic cinematic lighting with vivid colors'
      if (/\b(video|sora|runway|pika|gen-?3|image generation|diffusion|midjourney|flux)\b/.test(src))
        return 'cinematic film strip dissolving into vibrant digital particles, rich oranges and purples and teals, explosive color burst, creative studio aesthetic'
      if (/\b(voice|audio|speech|whisper|elevenlabs|tts|transcri)\b/.test(src))
        return 'sound wave visualization glowing in vivid cyan and magenta, abstract audio frequencies as luminous sine waves, rich color gradient background'
      if (/\b(code|terminal|developer|devtool|ide|cursor|copilot|coding|github)\b/.test(src))
        return 'terminal with glowing neon-green code cascading, vibrant syntax highlighting in blue and yellow, bright monitors illuminating developer workspace'
      if (/\b(research|paper|benchmark|arxiv|study|dataset|training|fine.tun)\b/.test(src))
        return 'research laboratory with vivid glowing screens showing colorful neural network graphs, rich teal and orange light, scientist silhouette with dramatic rim lighting'
      if (/\b(openai|anthropic|google|microsoft|meta ai|mistral|deepseek|xai)\b/.test(src))
        return 'sleek glass corporate tower at golden hour, warm amber and violet sky, vibrant city reflections, neon logo glow'
      return 'abstract neural network nodes connecting with luminous blue and purple threads, vivid electric colors, data flowing as glowing particles, rich deep blue and violet background'
    })()

    // ── Cover background ──
    let backgroundUrl: string | undefined
    try {
      const effectivePrompt = rawImagePrompt ?? FALLBACK_IMAGE_PROMPT
      const hasPerson = /\b(person|people|engineer|researcher|ceo|cto|founder|scientist|developer|man|woman|male|female|executive|professional|businessman|businesswoman|entrepreneur|headshot|portrait|worker|employee)\b/i.test(effectivePrompt)
      const imagePromptText = hasPerson
        ? `Cinematic 9:16 portrait photograph. ${effectivePrompt}. Dramatic lighting with vibrant rim light, rich colors, shot on Sony A7IV, shallow depth of field, subject in upper half of frame. Ultra photorealistic, NO TEXT on image.`
        : `Cinematic 9:16 vertical scene. ${effectivePrompt}. Vivid dramatic lighting, rich saturated colors, ultra detailed, photorealistic render or photograph, shallow depth of field. NO TEXT, NO WATERMARK on image.`
      // Hash-based cache: reutiliza imagem quando prompt idêntico já foi gerado antes
      const hash8 = createHash('sha256').update(imagePromptText).digest('hex').slice(0, 8)
      const coverPath = `covers/bg-${hash8}.png`
      const cachedUrl = supabase.storage.from('reels').getPublicUrl(coverPath).data.publicUrl
      const headRes = await fetch(cachedUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) }).catch(() => null)
      if (headRes?.ok) {
        backgroundUrl = cachedUrl
        console.log(`[reels-prepare] ✓ Cache hit hash ${hash8} — reutilizando imagem`)
      } else {
        const url = await generateStoredImage({ prompt: imagePromptText.slice(0, 3800), path: coverPath })
        if (url) {
          backgroundUrl = url
          sendFirstImageNotificationEmail(supabase, WORKSPACE_ID, url, imagePromptText).catch(() => {})
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isBilling = msg.includes('[BILLING]')
      console.error(`[reels-prepare] OpenAI background failed${isBilling ? ' (BILLING LIMIT)' : ''}:`, msg)
      Sentry.captureMessage(`reels-prepare: OpenAI background failed — ${isBilling ? 'BILLING LIMIT REACHED' : msg.slice(0, 120)}`, {
        level: 'error',
        tags: { cron: 'reels-prepare', step: 'background', author: v.source_author, billing: String(isBilling) },
      })
    }

    // Gate: never insert reel_ready without a cinematic background photo.
    // A gradient fallback is not acceptable — block and let the next cron run retry.
    if (!backgroundUrl) {
      skippedReasons.push(`${v.source_author}:no_background`)
      console.warn(`[reels-prepare] Blocked ${v.id} (@${v.source_author}) — backgroundUrl missing, reel not queued`)
      Sentry.captureMessage(`reels-prepare: reel bloqueado sem foto de fundo — @${v.source_author}`, {
        level: 'error',
        tags: { cron: 'reels-prepare', step: 'background_gate', author: v.source_author },
      })
      continue
    }

    // ── Insert reel_ready ──
    const subtitles = parseSrtToFrames(meta.srt_ptbr || '', 30)
    const { error: insertError } = await supabase.from('generated_content').insert({
      workspace_id: WORKSPACE_ID,
      curated_content_id: v.id,
      target_platform: 'instagram',
      target_format: 'reel',
      content: JSON.stringify({
        videoUrl,
        backgroundUrl,
        subtitles,
        hookTitle: meta.hookTitle,
        highlightWords: meta.highlightWords,
        highlightClause: meta.highlightClause ?? '',
        subtitle: meta.subtitle,
        caption: meta.caption,
        sourceAuthor: v.source_author,
        imagePrompt: meta.imagePrompt,
      }),
      status: 'reel_ready',
      model_used: reelPrepModel || 'gemini-2.5-flash',
      idioma: 'pt',
    })

    if (insertError) {
      skippedReasons.push(`${v.source_author}:insert_error(${insertError.message.slice(0,60)})`)
      Sentry.captureException(new Error(insertError.message), { tags: { cron: 'reels-prepare', step: 'insert_reel_ready' } })
      console.error('[reels-prepare] Insert failed:', insertError.message)
      continue
    }

    // Mark as written so writer agent doesn't re-process this item
    await supabase.from('curated_content').update({ status: 'written' }).eq('id', v.id)

    usedIds.add(v.id)
    prepared.push(v.source_author ?? v.id)
    console.log(`[reels-prepare] ✓ Prepared ${prepared.length}/${slotsToFill}: @${v.source_author}`)
    } catch (loopErr) {
      const sentinel = aiSentinelCode(loopErr)
      if (sentinel === AI_SENTINEL.RATE_LIMITED || sentinel === AI_SENTINEL.UNAVAILABLE) {
        const resetHours = sentinel === AI_SENTINEL.RATE_LIMITED ? 4 : 2
        const skipUntil = new Date(Date.now() + resetHours * 60 * 60 * 1000).toISOString()
        console.warn(`[reels-prepare] AI ${sentinel} for @${v.source_author} — skip for ${resetHours}h`)
        await supabase.from('curated_content').update({ skip_reason: sentinel, skip_until: skipUntil }).eq('id', v.id)
      } else {
        skippedReasons.push(`${v.source_author}:exception(${loopErr instanceof Error ? loopErr.message.slice(0,60) : String(loopErr).slice(0,60)})`)
        Sentry.captureException(loopErr, { tags: { cron: 'reels-prepare', step: 'item_loop', author: v.source_author ?? v.id } })
        console.error(`[reels-prepare] Uncaught error for @${v.source_author}:`, loopErr instanceof Error ? loopErr.message : loopErr)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    prepared: prepared.length,
    authors: prepared,
    slotsToFill,
    elapsedMs: Date.now() - runStart,
    v: 2,
    debug: { candidates: candidates.length, videoItems: videoItems.length, skipped: skippedReasons },
  })
}

// ── One-time image notification ──────────────────────────────────────────────

// Sends a single email when the first image is generated for a workspace.
// Stores a flag in workspace_settings so it never fires again.

async function sendFirstImageNotificationEmail(
  supabase: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  imageUrl: string,
  prompt: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const recipient = process.env.NOTIFICATION_EMAIL
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !recipient || !from) return

  const FLAG_KEY = 'image_first_notification_sent'

  const { data: existing } = await supabase
    .from('workspace_settings')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('key', FLAG_KEY)
    .maybeSingle()
  if (existing) return


  // Insert flag before sending — prevents double-send on concurrent runs

  const { error: insertErr } = await supabase.from('workspace_settings').insert({
    workspace_id: workspaceId,
    category: 'notifications',
    key: FLAG_KEY,
    value: new Date().toISOString(),
  })

  if (insertErr) return // concurrent run already inserted


  const { data: ws } = await supabase.from('workspaces').select('name').eq('id', workspaceId).single()
  const projectName = ws?.name ?? workspaceId

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `[Social Machine] 1ª imagem gerada — ${projectName}`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="margin-top:0">🖼 Sistema de imagem funcionando — ${projectName}</h2>
          <p>A primeira imagem do pipeline foi gerada com sucesso. Avalie abaixo:</p>
          <a href="${imageUrl}" target="_blank">
            <img src="${imageUrl}" style="max-width:100%;border-radius:8px;display:block;margin:16px 0;" />
          </a>
          <p style="font-size:12px;color:#555;"><strong>Prompt:</strong><br/>${prompt.slice(0, 400)}</p>
          <p style="font-size:11px;color:#999;">Aviso único — não será repetido para este workspace.<br/>
          ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
        </div>
      `,
    }),
  })
}

function parseSrtToFrames(srt: string, fps: number) {
  if (!srt.trim()) return []
  const entries: Array<{ text: string; startFrame: number; endFrame: number }> = []
  for (const block of srt.trim().split(/\n\n+/)) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const m = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/)
    if (!m) continue
    const g = m.slice(1).map(Number)
    const s = g[0]*3600 + g[1]*60 + g[2] + g[3]/1000
    const e = g[4]*3600 + g[5]*60 + g[6] + g[7]/1000
    const text = lines.slice(2).join(' ').trim()
    if (text) entries.push({ text, startFrame: Math.round(s*fps), endFrame: Math.round(e*fps) })
  }
  return entries
}
