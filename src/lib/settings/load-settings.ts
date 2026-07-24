/**
 * Load workspace settings from database.
 * All configurable values are stored in workspace_settings table.
 * Agents and pipeline components read from here instead of hardcoded defaults.
 */

import { getAdminClient } from '@/lib/supabase/admin'

// ── Variable definitions with metadata ──
export interface VariableDefinition {
  key: string
  category: string
  label: string
  description: string
  type: 'number' | 'string' | 'boolean'
  defaultValue: string
}

export const VARIABLE_DEFINITIONS: VariableDefinition[] = [
  // ── Branding ──
  { key: 'instagram_handle', category: 'branding', label: 'Instagram Handle', description: 'Handle principal do Instagram (com @)', type: 'string', defaultValue: '@your_brand' },
  { key: 'twitter_handle', category: 'branding', label: 'Twitter/X Handle', description: 'Handle principal do Twitter (sem @)', type: 'string', defaultValue: 'example_handle' },
  { key: 'brand_name', category: 'branding', label: 'Nome da Marca', description: 'Nome exibido em conteúdos e referências', type: 'string', defaultValue: 'Your Brand' },
  { key: 'reference_style_account', category: 'branding', label: 'Conta de Referência', description: 'Conta usada como referência de estilo (ex: @uncover.ai)', type: 'string', defaultValue: '@uncover.ai' },
  { key: 'owned_x_handles', category: 'branding', label: 'Owned X Handles', description: 'Lista CSV de handles do X controlados pela mesma operacao', type: 'string', defaultValue: 'example_handle' },
  { key: 'known_agent_x_handles', category: 'branding', label: 'Known Agent X Handles', description: 'Lista CSV de handles do X conhecidos como agentes automatizados', type: 'string', defaultValue: '' },

  // ── AI Models ──
  { key: 'reel_prep_model', category: 'ai_models', label: 'Modelo Reels Prepare', description: 'Modelo para gerar hookTitle/caption dos Reels', type: 'string', defaultValue: 'gemini-2.5-flash' },
  { key: 'reel_prep_max_tokens', category: 'ai_models', label: 'Max Tokens Reels', description: 'Limite de tokens na resposta do Claude para Reels', type: 'number', defaultValue: '2000' },
  { key: 'curator_model', category: 'ai_models', label: 'Modelo Curador', description: 'Modelo AI usado pelo agente curador', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'writer_model', category: 'ai_models', label: 'Modelo Redator', description: 'Modelo AI usado pelo agente redator', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'reviewer_model', category: 'ai_models', label: 'Modelo Revisor', description: 'Modelo AI usado pelo agente revisor', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'publisher_model', category: 'ai_models', label: 'Modelo Publisher', description: 'Modelo AI usado pelo agente publisher', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'engagement_model', category: 'ai_models', label: 'Modelo Engagement', description: 'Modelo AI usado pelos agentes de engagement', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'editor_chief_model', category: 'ai_models', label: 'Modelo Editor-Chefe', description: 'Modelo AI usado pelo editor-in-chief', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'seo_strategist_model', category: 'ai_models', label: 'Modelo SEO', description: 'Modelo AI usado pelo SEO strategist', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'social_strategist_model', category: 'ai_models', label: 'Modelo Social', description: 'Modelo AI usado pelo social strategist', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'ads_strategist_model', category: 'ai_models', label: 'Modelo Ads', description: 'Modelo AI usado pelo ads strategist', type: 'string', defaultValue: 'deepseek-chat' },

  // ── Pipeline ──
  { key: 'reel_min_relevance_score', category: 'pipeline', label: 'Score Mínimo para Reel', description: 'Score mínimo de relevância para um tweet virar Reel', type: 'number', defaultValue: '40' },
  { key: 'reel_lookback_hours', category: 'pipeline', label: 'Lookback Reels (horas)', description: 'Janela de tempo para buscar conteúdo curado para Reels', type: 'number', defaultValue: '48' },
  { key: 'reel_candidate_limit', category: 'pipeline', label: 'Limite de Candidatos Reel', description: 'Máximo de candidatos a vídeo por query', type: 'number', defaultValue: '20' },
  { key: 'reel_video_fps', category: 'pipeline', label: 'FPS do Vídeo', description: 'Frames por segundo para parsing de subtitles', type: 'number', defaultValue: '30' },
  { key: 'ai_keywords_pattern', category: 'pipeline', label: 'Regex AI Keywords', description: 'Regex para filtrar conteúdo AI/tech (case-insensitive)', type: 'string', defaultValue: '\\b(ai|artificial intelligence|machine learning|deep learning|llm|gpt|claude|openai|anthropic|deepseek|gemini|neural|model|agi|chatbot|automation|robot|coding|developer|startup|tech|software|algorithm|data|compute|gpu|training|inference|agent|prompt|token)\\b' },
  { key: 'dedup_similarity_threshold', category: 'pipeline', label: 'Threshold Dedup', description: 'Similaridade mínima para considerar duplicata (0-1)', type: 'number', defaultValue: '0.5' },
  { key: 'dedup_window_hours', category: 'pipeline', label: 'Janela Dedup (horas)', description: 'Janela de tempo para checagem de duplicatas', type: 'number', defaultValue: '48' },
  { key: 'monitor_max_topics', category: 'pipeline', label: 'Max Tópicos Monitor', description: 'Máximo de tópicos monitorados simultaneamente', type: 'number', defaultValue: '6' },
  { key: 'curator_max_posts_per_topic', category: 'pipeline', label: 'Max Posts por Tópico', description: 'Máximo de posts curados por tópico', type: 'number', defaultValue: '4' },
  { key: 'topic_expiry_hours', category: 'pipeline', label: 'Expiração Tópico (horas)', description: 'Tempo até um tópico expirar', type: 'number', defaultValue: '24' },
  { key: 'discover_sources_lookback_days', category: 'pipeline', label: 'Lookback Discovery (dias)', description: 'Janela para descobrir novas fontes', type: 'number', defaultValue: '7' },
  { key: 'discover_sources_min_engagement', category: 'pipeline', label: 'Engagement Mín Discovery', description: 'Engajamento mínimo para nova fonte', type: 'number', defaultValue: '5' },
  { key: 'discover_sources_max_new', category: 'pipeline', label: 'Max Novas Fontes', description: 'Máximo de novas fontes por execução', type: 'number', defaultValue: '10' },
  { key: 'evergreen_pillar_cursor', category: 'pipeline', label: 'Cursor Pilar Evergreen', description: 'Índice do pilar evergreen atual (0-6) usado por evergreen-seed-brand', type: 'number', defaultValue: '0' },

  // ── Trend Video ──
  { key: 'trend_video_enabled', category: 'trend_video', label: 'Trend Video Ativo', description: 'Liga o pipeline de trend -> capa + video', type: 'boolean', defaultValue: 'false' },
  { key: 'trend_video_sources', category: 'trend_video', label: 'Fontes Trend Video', description: 'Lista CSV de fontes de trend (ex: google_trends,x_trending)', type: 'string', defaultValue: 'google_trends,x_trending' },
  { key: 'trend_video_country_code', category: 'trend_video', label: 'País Trend Video', description: 'Código ISO do país para trends', type: 'string', defaultValue: 'BR' },
  { key: 'trend_video_max_topics_per_run', category: 'trend_video', label: 'Max Topics por Run', description: 'Máximo de topics coletados/preparados por execução', type: 'number', defaultValue: '6' },
  { key: 'trend_video_max_jobs_per_day', category: 'trend_video', label: 'Max Jobs por Dia', description: 'Máximo de vídeos trend gerados por dia', type: 'number', defaultValue: '1' },
  { key: 'trend_video_shots_per_video', category: 'trend_video', label: 'Shots por Vídeo', description: 'Quantidade de micro-shots cinematográficos por vídeo', type: 'number', defaultValue: '5' },
  { key: 'trend_video_default_duration_sec', category: 'trend_video', label: 'Duração por Shot', description: 'Duração padrão de cada shot em segundos', type: 'number', defaultValue: '3' },
  { key: 'trend_video_generation_mode', category: 'trend_video', label: 'Modo de Geração', description: 'prompt_video, hybrid ou image_to_video', type: 'string', defaultValue: 'hybrid' },
  { key: 'trend_video_blocked_keywords', category: 'trend_video', label: 'Blocked Keywords', description: 'Lista CSV de termos proibidos para trend videos', type: 'string', defaultValue: 'racismo,morte,morreu,obituario,assassinato,homicidio,briga,agressao,tiroteio,guerra,partido,eleicao,eleições,lula,bolsonaro,vereador,prefeito,governador,presidente' },
  { key: 'trend_video_allowed_categories', category: 'trend_video', label: 'Categorias Permitidas', description: 'Lista CSV de categorias preferidas para trend videos', type: 'string', defaultValue: 'technology' },
  { key: 'trend_video_required_keywords', category: 'trend_video', label: 'Required Keywords', description: 'Lista CSV de termos obrigatórios para o tema entrar no funil de trend video', type: 'string', defaultValue: 'gpt,chatgpt,openai,claude,anthropic,gemini,google ai,deepseek,llm,meta ai,llama,copilot,midjourney,sora,runway,higgsfield,perplexity,grok,inteligencia artificial,artificial intelligence' },
  { key: 'trend_video_style_rotation', category: 'trend_video', label: 'Rotação de Estilos', description: 'Lista CSV de estilos visuais a rotacionar', type: 'string', defaultValue: 'ultrarealista,anime,abstrato-cinematic' },
  { key: 'trend_video_default_cta', category: 'trend_video', label: 'CTA Padrão', description: 'CTA padrão no final do caption', type: 'string', defaultValue: 'Voce pode criar videos virais como esse usando o Claude. Comente \"PROMPT\".' },
  { key: 'trend_video_creative_model', category: 'trend_video', label: 'Modelo Criativo Trend Video', description: 'Modelo AI usado para gerar hook, prompts e CTA do pipeline trend video', type: 'string', defaultValue: 'deepseek-chat' },
  { key: 'trend_video_image_provider_chain', category: 'trend_video', label: 'Fallbacks de Imagem', description: 'Lista CSV de provedores de imagem para Trend Video: gemini,openai', type: 'string', defaultValue: 'gemini,openai' },
  { key: 'trend_video_higgsfield_model_default', category: 'trend_video', label: 'Modelo Higgsfield Padrão', description: 'Modelo default do Higgsfield para image-to-video', type: 'string', defaultValue: 'dop-preview' },
  { key: 'trend_video_higgsfield_model_fallbacks', category: 'trend_video', label: 'Fallbacks Higgsfield I2V', description: 'Lista CSV de modelos fallback do Higgsfield para image-to-video', type: 'string', defaultValue: 'dop-turbo,dop-lite' },
  { key: 'trend_video_higgsfield_text_model_default', category: 'trend_video', label: 'Modelo Higgsfield Prompt Video', description: 'Modelo default do Higgsfield para text-to-video/prompt-video', type: 'string', defaultValue: 'seedance-2.0' },
  { key: 'trend_video_higgsfield_text_model_fallbacks', category: 'trend_video', label: 'Fallbacks Higgsfield T2V', description: 'Lista CSV de modelos fallback do Higgsfield para text-to-video/prompt-video', type: 'string', defaultValue: '' },
  { key: 'trend_video_publish_platforms', category: 'trend_video', label: 'Plataformas de Publish', description: 'Lista CSV de plataformas para publish do MVP', type: 'string', defaultValue: 'instagram' },

  // ── Rate Limits ──
  { key: 'curator_max_actions_per_hour', category: 'rate_limits', label: 'Curador Max/Hora', description: 'Máximo de ações do curador por hora', type: 'number', defaultValue: '30' },
  { key: 'writer_max_actions_per_hour', category: 'rate_limits', label: 'Redator Max/Hora', description: 'Máximo de ações do redator por hora', type: 'number', defaultValue: '30' },
  { key: 'writer_max_items_per_run', category: 'rate_limits', label: 'Redator Items/Execução', description: 'Máximo de items por execução do redator', type: 'number', defaultValue: '3' },
  { key: 'writer_max_execution_ms', category: 'rate_limits', label: 'Redator Timeout (ms)', description: 'Timeout máximo de execução do redator', type: 'number', defaultValue: '90000' },
  { key: 'reviewer_max_actions_per_hour', category: 'rate_limits', label: 'Revisor Max/Hora', description: 'Máximo de ações do revisor por hora', type: 'number', defaultValue: '30' },
  { key: 'reviewer_max_items_per_run', category: 'rate_limits', label: 'Revisor Items/Execução', description: 'Máximo de items por execução do revisor', type: 'number', defaultValue: '10' },
  { key: 'publisher_max_actions_per_hour', category: 'rate_limits', label: 'Publisher Max/Hora', description: 'Máximo de ações do publisher por hora', type: 'number', defaultValue: '20' },
  { key: 'publisher_max_posts_per_run', category: 'rate_limits', label: 'Publisher Posts/Execução', description: 'Máximo de posts por execução do publisher', type: 'number', defaultValue: '5' },
  { key: 'engagement_own_max_actions_per_hour', category: 'rate_limits', label: 'Eng. Próprio Max/Hora', description: 'Máximo de ações engagement próprio por hora', type: 'number', defaultValue: '20' },
  { key: 'engagement_ext_max_actions_per_hour', category: 'rate_limits', label: 'Eng. Externo Max/Hora', description: 'Máximo de ações engagement externo por hora', type: 'number', defaultValue: '15' },
  { key: 'max_renders_per_day', category: 'rate_limits', label: 'Max Renders/Dia', description: 'Máximo de renders Remotion por dia', type: 'number', defaultValue: '15' },
  { key: 'comment_daily_reply_cap', category: 'rate_limits', label: 'Cap Respostas Comentários/Dia', description: 'Máximo de respostas automáticas a comentários no Instagram por workspace em 24h (anti-ban). Ausência da chave herda 80.', type: 'number', defaultValue: '80' },
  { key: 'autoreply_muted_media_ids', category: 'rate_limits', label: 'Media Mutados (Autoreply)', description: 'Lista CSV de instagram_media_id que NUNCA recebem auto-reply de comentário (ex: post viral que estourou a fila). Vazio = nada mutado.', type: 'string', defaultValue: '' },

  // ── Timeouts ──
  { key: 'cover_render_timeout_ms', category: 'timeouts', label: 'Timeout Cover (ms)', description: 'Timeout para render de capa no Railway', type: 'number', defaultValue: '90000' },
  // 90000 (era 120000, 2026-07-15): render + poll do Instagram compartilham os 300s de
  // maxDuration de reels-publish. Com o default antigo (120s) + poll antigo (20×5s=100s),
  // o orçamento nominal (sem nenhum travamento) já ficava sem folga segura em 300s.
  { key: 'video_render_timeout_ms', category: 'timeouts', label: 'Timeout Vídeo (ms)', description: 'Timeout para render FFmpeg no Railway', type: 'number', defaultValue: '90000' },
  { key: 'ig_poll_interval_ms', category: 'timeouts', label: 'IG Poll Intervalo (ms)', description: 'Intervalo de polling do status do Instagram', type: 'number', defaultValue: '5000' },
  // 12 (era 20, 2026-07-15): 20×5s=100s de poll nominal deixava pouca folga somado ao
  // render + criação de container + media_publish, todos dentro do mesmo maxDuration=300s.
  { key: 'ig_poll_max_attempts', category: 'timeouts', label: 'IG Poll Max Tentativas', description: 'Máximo de tentativas de polling do Instagram', type: 'number', defaultValue: '12' },
  { key: 'publisher_retry_attempts', category: 'timeouts', label: 'Publisher Retries', description: 'Máximo de tentativas de publicação', type: 'number', defaultValue: '3' },

  // ── Quality ──
  { key: 'reviewer_approval_threshold', category: 'quality', label: 'Threshold Aprovação', description: 'Score mínimo para aprovação automática (0-10)', type: 'number', defaultValue: '7.0' },
  { key: 'quality_gate_pass_score', category: 'quality', label: 'Score Mínimo Quality Gate', description: 'Score mínimo para passar no quality gate', type: 'number', defaultValue: '6' },
  { key: 'quality_gate_max_issues', category: 'quality', label: 'Max Issues Quality Gate', description: 'Máximo de issues permitidas no quality gate', type: 'number', defaultValue: '1' },
  { key: 'max_hashtags', category: 'quality', label: 'Max Hashtags', description: 'Máximo de hashtags por post', type: 'number', defaultValue: '2' },
  { key: 'max_emojis', category: 'quality', label: 'Max Emojis', description: 'Máximo de emojis por post', type: 'number', defaultValue: '1' },
  { key: 'tweet_max_length', category: 'quality', label: 'Max Caracteres Tweet', description: 'Limite de caracteres para tweets', type: 'number', defaultValue: '280' },
  { key: 'curator_min_text_length', category: 'quality', label: 'Min Texto Curadoria', description: 'Tamanho mínimo do texto para curadoria', type: 'number', defaultValue: '50' },
  { key: 'reviewer_weight_hook', category: 'quality', label: 'Peso Hook (Revisor)', description: 'Peso da dimensão hook no score do revisor (0–1, soma das 6 deve ser 1)', type: 'number', defaultValue: '0.20' },
  { key: 'reviewer_weight_insight', category: 'quality', label: 'Peso Insight (Revisor)', description: 'Peso da dimensão insight no score do revisor (0–1)', type: 'number', defaultValue: '0.20' },
  { key: 'reviewer_weight_voice', category: 'quality', label: 'Peso Voice (Revisor)', description: 'Peso da dimensão voice no score do revisor (0–1)', type: 'number', defaultValue: '0.20' },
  { key: 'reviewer_weight_size', category: 'quality', label: 'Peso Size (Revisor)', description: 'Peso da dimensão size no score do revisor (0–1)', type: 'number', defaultValue: '0.15' },
  { key: 'reviewer_weight_identity', category: 'quality', label: 'Peso Identity (Revisor)', description: 'Peso da dimensão identity no score do revisor (0–1)', type: 'number', defaultValue: '0.15' },
  { key: 'reviewer_weight_politics', category: 'quality', label: 'Peso Politics (Revisor)', description: 'Peso da dimensão politics no score do revisor (0–1)', type: 'number', defaultValue: '0.10' },

  // ── Quiet Hours ──
  { key: 'quiet_hours_start', category: 'quiet_hours', label: 'Início Silêncio (hora)', description: 'Hora de início do período de silêncio (0-23)', type: 'number', defaultValue: '0' },
  { key: 'quiet_hours_end', category: 'quiet_hours', label: 'Fim Silêncio (hora)', description: 'Hora de fim do período de silêncio (0-23)', type: 'number', defaultValue: '6' },
  { key: 'performance_lookback_days', category: 'quiet_hours', label: 'Lookback Performance (dias)', description: 'Dias de histórico para análise de performance', type: 'number', defaultValue: '7' },
  { key: 'ads_lookback_days', category: 'quiet_hours', label: 'Lookback Ads (dias)', description: 'Dias de histórico para análise de ads', type: 'number', defaultValue: '7' },
]

// Build defaults map from definitions
const DEFAULTS: Record<string, string> = {}
for (const def of VARIABLE_DEFINITIONS) {
  DEFAULTS[def.key] = def.defaultValue
}

// Category metadata for UI
export const CATEGORY_LABELS: Record<string, { label: string; description: string }> = {
  branding: { label: 'Branding', description: 'Handles, nomes e referências de marca' },
  ai_models: { label: 'Modelos AI', description: 'Modelos e limites de tokens por agente' },
  pipeline: { label: 'Pipeline', description: 'Thresholds, filtros e parâmetros de curadoria' },
  trend_video: { label: 'Trend Video', description: 'Configuração do pipeline tema -> capa + video' },
  rate_limits: { label: 'Rate Limits', description: 'Limites de ações por agente por hora/execução' },
  timeouts: { label: 'Timeouts', description: 'Timeouts de render, polling e retries' },
  quality: { label: 'Qualidade', description: 'Scores, limites de conteúdo e quality gates' },
  quiet_hours: { label: 'Horários & Lookback', description: 'Horários de silêncio e janelas de análise' },
}

// ── Legacy typed interface (backwards compat) ──
export interface WorkspaceSettings {
  reviewer_approval_threshold: number
  quality_gate_pass_score: number
  quality_gate_max_issues: number
  dedup_similarity_threshold: number
  dedup_window_hours: number
  max_hashtags: number
  max_emojis: number
  tweet_max_length: number
  max_posts_per_run: number
  target_handle: string
  instagram_handle: string
  own_twitter_handle: string
  curator_banned_keywords: string
  monitor_max_topics: number
  curator_max_posts_per_topic: number
  writer_max_items_per_run: number
  reviewer_max_items_per_run: number
  topic_expiry_hours: number
  topic_dedup_window_hours: number
  performance_lookback_days: number
  ads_lookback_days: number

  // Reels
  reels_relevance_threshold: number
  reels_freshness_hours: number
  min_reels_per_day: number
}

const LEGACY_DEFAULTS: WorkspaceSettings = {
  reviewer_approval_threshold: 7.0,
  quality_gate_pass_score: 6,
  quality_gate_max_issues: 1,
  dedup_similarity_threshold: 0.5,
  dedup_window_hours: 48,
  max_hashtags: 2,
  max_emojis: 1,
  tweet_max_length: 280,
  max_posts_per_run: 1,
  target_handle: 'example_handle',
  instagram_handle: '@your_brand',
  own_twitter_handle: 'your_brand',
  curator_banned_keywords: 'crypto,defi,blockchain,token,nft,trading,forex,mineracao,airdrop,wallet,altcoin,staking,ethereum,eth,btc,bitcoin,virtual protocol,depin,web3,solana,xrp,binance,coinbase,doge,shiba,hodl,memecoin',
  monitor_max_topics: 6,
  curator_max_posts_per_topic: 4,
  writer_max_items_per_run: 10,
  reviewer_max_items_per_run: 10,
  topic_expiry_hours: 24,
  topic_dedup_window_hours: 24,
  performance_lookback_days: 7,
  ads_lookback_days: 7,
  reels_relevance_threshold: 25,
  reels_freshness_hours: 168,
  min_reels_per_day: 1,
}

// In-memory cache with 5-minute TTL
let cache: { values: Record<string, string>; workspaceId: string; loadedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

async function loadRawSettings(workspaceId: string): Promise<Record<string, string>> {
  if (cache && cache.workspaceId === workspaceId && (Date.now() - cache.loadedAt) < CACHE_TTL_MS) {
    return cache.values
  }

  const supabase = getAdminClient()
  const { data } = await supabase
    .from('workspace_settings')
    .select('key, value')
    .eq('workspace_id', workspaceId)

  const dbValues: Record<string, string> = {}
  for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
    dbValues[row.key] = row.value
  }

  cache = { values: dbValues, workspaceId, loadedAt: Date.now() }
  return dbValues
}

/**
 * Get a single variable value (new API — reads any variable by key).
 */
export async function getVariable(workspaceId: string, key: string): Promise<string> {
  const dbValues = await loadRawSettings(workspaceId)
  return dbValues[key] ?? DEFAULTS[key] ?? ''
}

/**
 * Get a numeric variable.
 */
export async function getNumericVariable(workspaceId: string, key: string): Promise<number> {
  const val = await getVariable(workspaceId, key)
  return parseFloat(val) || 0
}

/**
 * Load all settings for a workspace (legacy typed interface).
 */
export async function loadSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const dbValues = await loadRawSettings(workspaceId)

  const settings: WorkspaceSettings = { ...LEGACY_DEFAULTS }

  for (const key of Object.keys(LEGACY_DEFAULTS) as Array<keyof WorkspaceSettings>) {
    if (dbValues[key] !== undefined) {
      const defaultVal = LEGACY_DEFAULTS[key]
      if (typeof defaultVal === 'number') {
        (settings[key] as number) = parseFloat(dbValues[key]) || (defaultVal as number)
      } else {
        (settings[key] as string) = dbValues[key]
      }
    }
  }

  return settings
}

/**
 * Get a single setting value (legacy typed).
 */
export async function getSetting<K extends keyof WorkspaceSettings>(
  workspaceId: string,
  key: K
): Promise<WorkspaceSettings[K]> {
  const settings = await loadSettings(workspaceId)
  return settings[key]
}

/**
 * Update a setting value in the database.
 */
export async function updateSetting(
  workspaceId: string,
  category: string,
  key: string,
  value: string
): Promise<void> {
  const supabase = getAdminClient()
  const def = VARIABLE_DEFINITIONS.find(d => d.key === key)
  await supabase
    .from('workspace_settings')
    .upsert(
      {
        workspace_id: workspaceId,
        category,
        key,
        value: String(value),
        description: def?.description || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,category,key' }
    )

  cache = null
}

/**
 * Get all settings grouped by category (includes defaults for missing keys).
 */
export async function getAllSettings(workspaceId: string): Promise<
  Array<{ category: string; key: string; value: string; description: string | null }>
> {
  const dbValues = await loadRawSettings(workspaceId)

  return VARIABLE_DEFINITIONS.map(def => ({
    category: def.category,
    key: def.key,
    value: dbValues[def.key] ?? def.defaultValue,
    description: def.description,
  }))
}
