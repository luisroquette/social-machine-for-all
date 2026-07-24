import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { getAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/database.types'
import { searchTweets, type TweetSearchResult } from '@/lib/platforms/x/search'
import { extractKeywordFingerprint, isDuplicateCuratedContent } from '@/lib/pipeline/dedup'
import { getNumericVariable, getVariable } from '@/lib/settings/load-settings'
import { XClient } from '@/lib/platforms/x/client'
import { calculateViralityScore } from '@/lib/pipeline/virality-score'
import { buildAuthorReachWeights } from '@/lib/eval/curator-feedback'
import { searchYouTubeVideos, getChannelLatestVideos, resolveChannelHandle, getVideoStatistics } from '@/lib/platforms/youtube/reader'
import { getInstagramAccountReels } from '@/lib/platforms/instagram/reader'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { fetchRssFeed } from '@/lib/platforms/rss/reader'
import { hasNegativeEvFraming } from '@/lib/brand/brand-brand-safety'
import { loadWorkspaceFeatures } from '@/lib/config/workspace-features'

// Keywords required for a video to be reel_eligible when EV curation is enabled.
// At least one must appear in the tweet text (case-insensitive).
const BRAND_REEL_KEYWORDS = [
  // ── EV / vehicles (EN) ────────────────────────────────────────────────────
  'electric vehicle', 'electric car', 'electric truck', 'electric bus', 'electric fleet',
  'electric van', 'electric pickup', 'electric suv', 'electric motorcycle', 'electric bike',
  'electric scooter', 'electric aircraft', 'electric boat', 'electric ship',
  'zero emission', 'zero-emission', 'zero emissions',
  'plug-in hybrid', 'plug in hybrid', 'phev', 'bev', 'fcev', 'hybrid electric',
  'range anxiety', 'battery range', 'driving range',
  // ── Charging (EN) ─────────────────────────────────────────────────────────
  'ev charging', 'ev charger', 'fast charge', 'fast charger', 'fast charging',
  'dc charging', 'dc fast', 'ultra-fast charging', 'ultra fast charging',
  'charging station', 'charging infrastructure', 'charging network', 'charging point',
  'supercharger', 'chademo', 'ccs charging', 'ac charging', 'level 2 charging',
  'home charging', 'public charging', 'wireless charging', 'bidirectional charging',
  'vehicle-to-grid', 'v2g', 'vehicle to grid',
  // ── Energy storage / batteries (EN) ───────────────────────────────────────
  'battery storage', 'bess', 'energy storage', 'battery pack', 'battery cell',
  'solid state battery', 'solid-state battery', 'lithium-ion', 'lithium ion',
  'sodium-ion', 'sodium ion', 'battery technology', 'battery capacity',
  'grid storage', 'stationary storage', 'long duration storage',
  'gigafactory', 'battery factory', 'cell manufacturing',
  // ── Renewables / clean energy (EN) ────────────────────────────────────────
  'solar energy', 'solar panel', 'solar power', 'solar farm', 'solar plant',
  'photovoltaic', 'pv solar', 'rooftop solar',
  'wind energy', 'wind power', 'wind farm', 'offshore wind', 'onshore wind',
  'renewable energy', 'renewables', 'clean energy', 'clean power', 'clean tech',
  'green energy', 'green power', 'green hydrogen', 'hydrogen fuel',
  'energy transition', 'decarbonisation', 'decarbonization', 'net zero', 'net-zero',
  'carbon neutral', 'carbon neutrality', 'carbon footprint', 'carbon emissions',
  'climate tech', 'cleantech', 'sustainability', 'sustainable energy',
  'electrification', 'grid decarbonization', 'power grid', 'smart grid',
  // ── EV brands / OEMs (EN) ─────────────────────────────────────────────────
  // 'tesla' standalone REMOVED — appears in financial/Musk news with no EV context.
  // Require an EV-specific modifier to prevent contamination from tech/semiconductor articles.
  'tesla model', 'tesla electric', 'tesla supercharger', 'tesla energy', 'tesla powerwall',
  'tesla megapack', 'tesla semi', 'tesla cybertruck', 'tesla gigafactory', 'tesla battery',
  'tesla fsd', 'tesla autopilot', 'model 3', 'model y', 'model s', 'model x',
  'byd', 'rivian', 'lucid motors', 'lucid air', 'nio', 'xpeng', 'li auto',
  'volkswagen id', 'vw id.', 'bmw i', 'bmw ix', 'mercedes eq', 'mercedes eqs',
  'hyundai ioniq', 'kia ev', 'ford mustang mach-e', 'ford f-150 lightning',
  'gm ultium', 'chevy equinox ev', 'silverado ev', 'hummer ev',
  'porsche taycan', 'audi e-tron', 'audi q8 e-tron', 'volvo ex',
  'polestar', 'fisker', 'vinfast', 'leapmotor', 'zeekr', 'avatr',
  'scout motors', 'canoo', 'arrival', 'atlis', 'aptera',
  // ── Charging / energy companies (EN) ──────────────────────────────────────
  'wallbox', 'chargepoint', 'evgo', 'electrify america', 'blink charging',
  'ionity', 'bp pulse', 'pod point', 'osprey', 'gridserve',
  'enphase', 'sma solar', 'solaredge', 'nextracker', 'array technologies',
  'fluence', 'form energy', 'ess tech', 'ambri', 'energy vault',
  // ── Mobility / infrastructure (EN) ────────────────────────────────────────
  'e-mobility', 'emobility', 'micromobility', 'shared mobility', 'fleet electrification',
  'autonomous vehicle', 'self-driving car', 'self-driving ev', 'tesla fsd', 'full self-driving',
  // 'autopilot' REMOVED — matches Microsoft Copilot "Autopilot" agents (false positive).
  // 'fsd' REMOVED — too short, ambiguous acronym. Use 'tesla fsd' above.
  'waymo', 'cruise autonomous', 'hydrogen vehicle', 'fuel cell vehicle', 'hydrogen economy',
  // ── PT/BR — veículos elétricos ─────────────────────────────────────────────
  'veículo elétrico', 'veiculo eletrico', 'carro elétrico', 'carro eletrico',
  'moto elétrica', 'moto eletrica', 'ônibus elétrico', 'onibus eletrico',
  'caminhão elétrico', 'caminhao eletrico', 'van elétrica', 'van eletrica',
  'frota elétrica', 'frota eletrica', 'mobilidade elétrica', 'mobilidade eletrica',
  'eletrificação', 'eletrificacao', 'zero emissão', 'zero emissao',
  'emissão zero', 'emissao zero', 'autonomia', 'recarga rápida', 'recarga rapida',
  // ── PT/BR — carregamento ──────────────────────────────────────────────────
  'eletroposto', 'ponto de recarga', 'estação de recarga', 'estacao de recarga',
  'carregador', 'recarga', 'carregamento', 'infraestrutura de recarga',
  'recarga ultrarrápida', 'recarga ultrarrapida', 'recarga rápida dc',
  'veículo-para-rede', 'v2g brasil',
  // ── PT/BR — bateria / armazenamento ──────────────────────────────────────
  'bateria', 'bateria de lítio', 'bateria de litio', 'bateria sólida', 'bateria solida',
  'armazenamento de energia', 'armazenamento energético', 'storage de energia',
  'célula de bateria', 'celula de bateria', 'pack de bateria',
  // ── PT/BR — energia renovável ─────────────────────────────────────────────
  'energia solar', 'painel solar', 'usina solar', 'fazenda solar',
  'energia eólica', 'energia eolica', 'parque eólico', 'parque eolico',
  'energia renovável', 'energia renovavel', 'energia limpa', 'energia verde',
  'hidrogênio verde', 'hidrogenio verde', 'célula de combustível', 'celula de combustivel',
  'transição energética', 'transicao energetica', 'descarbonização', 'descarbonizacao',
  'neutralidade de carbono', 'carbono neutro', 'pegada de carbono', 'emissões de carbono',
  'tecnologia limpa', 'sustentabilidade', 'sustentável', 'sustentavel',
  'rede elétrica', 'rede eletrica', 'rede inteligente', 'smart grid brasil',
  // ── PT/BR — marcas / empresas ─────────────────────────────────────────────
  'your brand', 'byd brasil', 'tesla brasil', 'intelbras',
  'weg energia', 'emob', 'abve', 'abee', 'abeev',
  // ── B2B EV — condomínios, shoppings, postos ────────────────────────────────
  'ev charging condominium', 'ev charging parking', 'ev charging shopping',
  'ev charging workplace', 'charging point installation', 'charge point operator',
  'cpo ev', 'emsp', 'roaming ev',
  'eletroposto condomínio', 'eletroposto condominio', 'eletroposto shopping',
  'eletroposto posto', 'eletroposto empresa', 'garagem elétrica', 'garagem eletrica',
  // ── Técnico — protocolos e padrões ────────────────────────────────────────
  'ocpp', 'ccs2', 'mennekes', 'type 2 charger', 'sae j1772',
  'v2b', 'vehicle to building', 'v2h', 'vehicle to home',
  'smart charging', 'load balancing ev', 'peak shaving ev', 'demand response ev',
  '350kw charger', '150kw charger', '50kw charger',
  // ── Mercado brasileiro EV ─────────────────────────────────────────────────
  'byd atto', 'byd seal', 'byd dolphin',
  'renault zoe brasil', 'volkswagen id.3', 'volkswagen id.4', 'id.buzz',
  'receita passiva eletroposto', 'parceria eletroposto', 'modelo 50 50 ev',
  'lançamento elétrico', 'financiamento carro elétrico', 'isenção ipva elétrico',
]

// Competitor EV charging operators — NEVER curate their content.
// These companies operate charging networks and post promotional/advertising content
// that would appear as if Brand is endorsing a competitor.
// Checked by authorHandle (case-insensitive). Add any new competitor discovered here.
export const BRAND_COMPETITOR_ACCOUNTS = [
  'chargepoint', 'chargepoint_eu',
  'evgo', 'evgonetwork',
  'wallboxev', 'wallboxlatam', 'wallbox',
  'electrify_america', 'electrifyamerica',
  'chargersbrasil', 'chargerbrasil',
  'chargeupenergymy', 'chargupenergy', 'chargeupmy', 'chargeup',
  'blink_charging', 'blinkcharging',
  'tritiumcharging', 'tritiumev',
  'abreva_ev', 'eletromidia',
  'greenlots',
  'volta_charging',
  'ampleev',
  'ionity_eu', 'ionity',
]

// CTA content patterns — posts that offer a distributable resource in exchange for a comment/DM.
// Used by Optimization 11 to surface this content type for @your_ai_profile (AI&Tech workspace).
// The writer then has a 1-in-4 chance to close with "Comente [PALAVRA] aqui que te mando o link via DM."
export const CTA_BOOST_PATTERNS = [
  'comente', 'comment below', 'comment and', 'reply with', 'reply and',
  'dm me', 'dm for', 'dm to get', 'send me a dm', 'drop a comment',
  'type below', 'type yes', 'repositório', 'repositorio', 'template',
  'cheatsheet', 'cheat sheet', 'ebook', 'free guide', 'free list',
  'free resource', 'free pdf', 'free course', 'free tools', 'free repo',
  'github.com', 'notion.so', 'lista gratuita', 'pdf gratuito',
  'guia gratuito', 'acesso gratuito', 'código grátis', 'codigo gratis',
]

// Chinese wall: pure-AI/software content that NEVER belongs in brandmob (EV B2B).
// Checked BEFORE keyword matching — a blocklisted phrase short-circuits regardless of EV keywords.
// This prevents cross-contamination from AI tech content that incidentally mentions EV brands.
export const BRAND_NONEV_BLOCKLIST = [
  'microsoft copilot', 'github copilot', 'autopilot agent', 'autopilot scout',
  'cursor pro', 'cursor ai', 'cursor ide', 'cursor.com',
  'chatgpt', 'gpt-4', 'gpt-5', 'gpt-4o', 'gpt-4.1',
  'claude ai', 'claude sonnet', 'claude opus', 'claude code', 'anthropic',
  'gemini pro', 'gemini flash', 'gemini ultra', 'google gemini',
  'midjourney', 'stable diffusion', 'dall-e', 'sora openai',
  'mai image', 'mai voice', 'mai transcribe',         // Microsoft AI product line
  'large language model', 'foundation model', 'llm ',
  'copilot+', 'copilot studio', 'microsoft build',    // Microsoft AI events/products
]

export function isCompetitorAccount(authorHandle: string, evMarketCuration = false): boolean {
  if (!evMarketCuration) return false
  const lower = authorHandle.toLowerCase().replace(/^@/, '')
  return BRAND_COMPETITOR_ACCOUNTS.some(acc => lower === acc || lower.startsWith(acc))
}

export function isTopicRelevant(text: string, evMarketCuration = false): boolean {
  if (!evMarketCuration) return true
  const lower = text.toLowerCase()
  // Brand safety: EV associado a perigo (incêndio, acidente, recall) nunca entra.
  // A brand VENDE eletromobilidade — manchete de medo afasta o comprador.
  // Descartar o item, não reenquadrar. Ver src/lib/brand/brand-brand-safety.ts.
  if (hasNegativeEvFraming(lower)) return false
  // Chinese wall: block known AI/software content before checking EV keywords
  if (BRAND_NONEV_BLOCKLIST.some(kw => lower.includes(kw))) return false
  return BRAND_REEL_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * Curator Agent — FIRST in the pipeline.
 *
 * Searches X API using 3 data sources:
 *   1. Trending Topics — filtered by workspace keywords
 *   2. Monitored Profiles — from monitor_sources table
 *   3. Keyword Search — workspace topic_keywords
 *
 * Deduplicates, ranks by engagement, and saves to curated_content.
 * NO AI fallback — if the API fails or returns nothing, we return empty.
 */
class CuratorAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'curator',
      name: 'Curador',
      role: 'curator',
      description: 'Busca tweets reais no X API usando trending, perfis monitorados e keywords',
      defaultModel: 'deepseek-chat',
      pipelineStage: 1,
      maxActionsPerHour: 30,
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    let totalCurated = 0
    const errors: string[] = []
    const features = await loadWorkspaceFeatures(ctx.workspaceId)

    // ── Load configurable thresholds from settings ──
    const reelMinRelevanceScore = await getNumericVariable(ctx.workspaceId, 'reel_min_relevance_score')
    const curatorMinTextLength = await getNumericVariable(ctx.workspaceId, 'curator_min_text_length')
    const maxTweetAgeHours = await getNumericVariable(ctx.workspaceId, 'curator_max_tweet_age_hours') || 48
    const maxProfilesPerRun = await getNumericVariable(ctx.workspaceId, 'curator_max_profiles_per_run') || 10
    const profileOffsetRaw = await getNumericVariable(ctx.workspaceId, 'curator_profile_offset') || 0
    const offset = profileOffsetRaw
    const ageCutoff = new Date(Date.now() - maxTweetAgeHours * 60 * 60 * 1000)

    // Source tracking
    const sourceCounts = { trending: 0, profile: 0, keyword: 0, youtube: 0, instagram: 0, rss: 0 }
    const trendingMatched: string[] = []
    const profileCounts: Record<string, number> = {}

    // ── 0. Load workspace keywords ──
    let keywords: string[] = []
    try {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('topic_keywords')
        .eq('id', ctx.workspaceId)
        .single()

      keywords = (workspace?.topic_keywords as string[]) ?? []
    } catch (err) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [`Failed to load workspace: ${err instanceof Error ? err.message : String(err)}`],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: {},
      }
    }

    // Check X API credentials
    if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_ACCESS_TOKEN) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: ['Missing X API credentials (TWITTER_API_KEY or TWITTER_ACCESS_TOKEN)'],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_credentials' },
      }
    }

    // Collect all tweets with source tagging
    type TaggedTweet = TweetSearchResult & { source: 'trending' | 'profile' | 'keyword'; trendingTerm?: string; brazilScoped?: boolean }
    const allTweets: TaggedTweet[] = []

    // ── Source 1: Radar keyword search (TwitterAPI.io primary, X API fallback) ──
    // brandmob uses EV-specific radar queries; AI&Tech uses the standard RADAR_QUERIES.
    // CHINESE WALL: RADAR_QUERIES are AI/tech focused — never run for brandmob.
    try {
      const { RADAR_QUERIES, RADAR_QUERIES_EV } = await import('@/lib/platforms/x/radar-queries')
      const activeQueries = features.ev_market_curation ? RADAR_QUERIES_EV : RADAR_QUERIES
      const twitterApiIoKey = process.env.TWITTERAPI_IO_KEY
      console.log(`[curator] Radar source: ${twitterApiIoKey ? 'TwitterAPI.io' : 'X API'} (${activeQueries.length} queries) [${features.ev_market_curation ? 'EV' : 'standard'}]`)

      for (const rq of activeQueries) {
        try {
          if (twitterApiIoKey) {
            // Primary: TwitterAPI.io (no credit limits, unlimited search)
            const { searchTwitterApiIo, extractMediaFromIoTweet } = await import('@/lib/platforms/x/twitterapi-io')
            const result = await searchTwitterApiIo(rq.query, twitterApiIoKey)
            for (const t of result.tweets) {
              if ((t.text?.length ?? 0) < curatorMinTextLength) continue
              if (isCompetitorAccount(t.author?.userName ?? '', features.ev_market_curation)) {
                console.log(`[curator] 🚫 Skipping competitor account @${t.author?.userName} (EV operator blocklist)`)
                continue
              }
              allTweets.push({
                id: t.id,
                text: t.text,
                authorHandle: t.author?.userName ?? '',
                authorName: t.author?.name ?? '',
                authorFollowers: t.author?.followers ?? 0,
                authorFollowing: 0,
                authorVerified: t.author?.isBlueVerified ?? false,
                createdAt: t.createdAt ?? new Date().toISOString(),
                tweetUrl: `https://x.com/${t.author?.userName}/status/${t.id}`,
                metrics: {
                  likes: t.likeCount ?? 0,
                  retweets: t.retweetCount ?? 0,
                  replies: t.replyCount ?? 0,
                  quotes: t.quoteCount ?? 0,
                  views: t.viewCount ?? 0,
                },
                ...extractMediaFromIoTweet(t),
                hasExternalLink: false,
                source: 'trending' as const,
                brazilScoped: rq.brazilScoped ?? false,
              })
              sourceCounts.trending++
            }
          } else {
            // Fallback: X API official
            const tweets = await searchTweets(rq.query, 10)
            for (const t of tweets.filter(tw => tw.text.length >= curatorMinTextLength)) {
              allTweets.push({ ...t, source: 'trending', brazilScoped: rq.brazilScoped ?? false })
              sourceCounts.trending++
            }
          }
        } catch (err) {
          errors.push(`Radar ${rq.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (sourceCounts.trending > 0) trendingMatched.push(`${sourceCounts.trending} radar tweets (${twitterApiIoKey ? 'TwitterAPI.io' : 'X API'})`)
    } catch (err) {
      errors.push(`Radar init: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Build trending terms set for score boosting (Optimization 7)
    const trendingTerms = new Set(trendingMatched.map(t => t.toLowerCase()))

    // ── Source 2: Monitored Profiles ──
    const profilePriorityMap: Record<string, number> = {}
    try {
      // Limit profiles per run to avoid Vercel 10min timeout (361 profiles → timeout).
      // Rotate by last_checked_at so all profiles are visited over multiple runs.
      const PROFILES_PER_RUN = 120
      const { data: profiles, error: profileError } = await supabase
        .from('monitor_sources')
        .select('id, handle, min_engagement, feed_url, last_checked_at')
        .eq('workspace_id', ctx.workspaceId)
        .eq('platform', 'x')
        .eq('active', true)
        .order('last_checked_at', { ascending: true, nullsFirst: true })
        .limit(PROFILES_PER_RUN)

      if (profileError) {
        errors.push(`Monitor sources query error: ${profileError.message}`)
      }

      // Build priority map (using min_engagement as proxy for priority)
      for (const profile of (profiles ?? []) as Array<{ handle: string; min_engagement: number }>) {
        profilePriorityMap[profile.handle] = Math.min(5, Math.max(1, Math.ceil((profile.min_engagement ?? 5) / 5)))
      }

      for (const profile of (profiles ?? []) as Array<{ id: string; handle: string; feed_url: string | null }>) {
        try {
          const sinceId = profile.feed_url || undefined
          const query = `from:${profile.handle} -is:retweet`
          const tweets = await searchTweets(query, 10, sinceId)

          // Update last_checked_at regardless of results
          await supabase
            .from('monitor_sources')
            .update({ last_checked_at: new Date().toISOString() })
            .eq('id', profile.id)

          if (tweets.length === 0) {
            // No new tweets since last check — skip processing
            continue
          }

          // Save the latest tweet ID as since_id for next run
          const latestTweetId = tweets.reduce((max, tw) =>
            BigInt(tw.id) > BigInt(max) ? tw.id : max, tweets[0].id)
          await supabase
            .from('monitor_sources')
            .update({ feed_url: latestTweetId })
            .eq('id', profile.id)

          const filtered = tweets.filter(tw =>
            tw.text.length >= curatorMinTextLength &&
            !isCompetitorAccount(tw.authorHandle, features.ev_market_curation)
          )
          for (const t of filtered) {
            allTweets.push({ ...t, source: 'profile' })
            sourceCounts.profile++
          }
          if (filtered.length > 0) {
            profileCounts[profile.handle] = (profileCounts[profile.handle] ?? 0) + filtered.length
          }
        } catch (err) {
          errors.push(`Profile @${profile.handle}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Persist next offset so subsequent runs rotate to different profiles
      if ((profiles?.length ?? 0) > 0) {
        const nextOffset = (offset + maxProfilesPerRun) % (profiles?.length ?? 1)
        await supabase
          .from('workspace_settings')
          .upsert(
            { workspace_id: ctx.workspaceId, category: 'curator', key: 'curator_profile_offset', value: String(nextOffset) },
            { onConflict: 'workspace_id,category,key' }
          )
      }
    } catch (err) {
      errors.push(`Monitor sources query: ${err instanceof Error ? err.message : String(err)}`)
    }

    // ── Source 3: Keyword Search (original approach) ──
    const disableKeywordSearch = (await getVariable(ctx.workspaceId, 'curator_disable_keyword_search')) === 'true'
    if (keywords.length > 0 && !disableKeywordSearch) {
      const keywordCount = await getNumericVariable(ctx.workspaceId, 'curator_source3_keyword_count') || 5
      const topKeywords = keywords.slice(0, keywordCount)
      for (const kw of topKeywords) {
        try {
          // PT-BR keywords (accented chars) → force lang:pt for brandmob
          const hasPtAccent = /[áãâéêíóõôúçÁÃÂÉÊÍÓÕÔÚÇ]/.test(kw)
          const langFilter = (features.ev_market_curation && hasPtAccent) ? ' lang:pt' : ''
          const tweets = await searchTweets(`${kw} has:videos -is:retweet${langFilter}`, 10)
          // Minimum 1000 followers on keyword search — blocks bots and spam accounts
          const filtered = tweets.filter(tw =>
            tw.text.length >= curatorMinTextLength &&
            tw.authorFollowers >= 1000 &&
            !isCompetitorAccount(tw.authorHandle, features.ev_market_curation)
          )
          for (const t of filtered) {
            allTweets.push({ ...t, source: 'keyword' })
            sourceCounts.keyword++
          }
        } catch (err) {
          errors.push(`Keyword "${kw}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    // ── 1. Dedup by tweet ID across all sources ──
    const seenIds = new Set<string>()
    const uniqueTweets: TaggedTweet[] = []
    for (const t of allTweets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id)
        uniqueTweets.push(t)
      }
    }

    // ── 1b. Hard age cutoff — reject tweets older than maxTweetAgeHours ──
    // Virality decay is soft (15% weight) — viral old tweets still score high without this guard
    const freshTweets = uniqueTweets.filter(t => new Date(t.createdAt) >= ageCutoff)
    const rejectedByAge = uniqueTweets.length - freshTweets.length
    if (rejectedByAge > 0) {
      console.log(`[curator] Rejected ${rejectedByAge} tweets older than ${maxTweetAgeHours}h`)
    }

    // ── 2. Rank by Virality Score (Equação Uchu) ──

    // Brand scope enforcement: banned keywords zero-out the score so off-topic tweets
    // never reach the writer. Defaults mirror the writer's hardcoded exclusion list.
    const bannedKeywordsRaw = String(
      ctx.settings?.curator_banned_keywords ??
      'crypto,defi,blockchain,token,nft,trading,forex,mineracao,airdrop,wallet,altcoin,staking'
    )
    const bannedKeywords = bannedKeywordsRaw
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)

    // Feedback de engajamento: peso por autor aprendido do reach REAL dos reels publicados.
    const authorReachWeights = await buildAuthorReachWeights(ctx.workspaceId)

    const rankedTweets = freshTweets.map(t => {
      const virality = calculateViralityScore({
        likes: t.metrics.likes,
        retweets: t.metrics.retweets,
        replies: t.metrics.replies,
        quotes: t.metrics.quotes,
        views: t.metrics.views,
        authorFollowers: t.authorFollowers,
        authorFollowing: t.authorFollowing,
        authorVerified: t.authorVerified,
        createdAt: t.createdAt,
        text: t.text,
        hasMedia: t.hasMedia,
        mediaTypes: t.mediaTypes,
        hasExternalLink: t.hasExternalLink,
      })

      let adjustedScore = virality.score

      // Brand filter: zero-out score for off-topic content before any boost is applied
      const textLower = t.text.toLowerCase()
      if (bannedKeywords.some(k => textLower.includes(k))) {
        return { ...t, virality: { ...virality, score: 0 }, ctaContent: false }
      }

      // Workspace topic filter: for Brand, only accept EV/energy/charging content
      if (!isTopicRelevant(t.text, features.ev_market_curation)) {
        return { ...t, virality: { ...virality, score: 0 }, ctaContent: false }
      }

      // Optimization 7: Trending boost — if tweet text contains a trending term, boost by 20%
      const trendingBoost = Array.from(trendingTerms).some(term => textLower.includes(term)) ? 1.2 : 1.0
      adjustedScore = Math.min(100, Math.round(adjustedScore * trendingBoost))

      // Optimization 8: Profile priority boost — higher priority profiles get up to 50% boost
      if (t.source === 'profile') {
        const profilePriority = profilePriorityMap[t.authorHandle] ?? 1
        adjustedScore = Math.min(100, Math.round(adjustedScore * (1 + (profilePriority - 1) * 0.125)))
      }

      // Optimization 9 (brandmob only): B2B niche boost — rewards industry-specific content
      // over generic viral posts that happen to mention EVs. Stacks with PT-BR boost.
      if (features.ev_market_curation) {
        const B2B_HIGH_VALUE = [
          'ocpp', 'ccs2', 'mennekes', 'sae j1772', 'dc fast', 'charging infrastructure',
          'eletroposto', 'fleet electrification', 'frota elétrica', 'frota eletrica',
          'ev fleet', 'commercial ev', 'condominium', 'condomínio', 'condominio',
          'workplace charging', 'smart charging', 'load balancing ev', 'v2g',
          'vehicle to grid', 'bess', 'energy storage system', 'demand response ev',
          'isenção ipva', 'isencao ipva', 'incentivo elétrico', 'abve', 'abeev',
          'cpo ev', 'charge point operator', 'emsp',
        ]
        if (B2B_HIGH_VALUE.some(term => textLower.includes(term))) {
          adjustedScore = Math.min(100, Math.round(adjustedScore * 1.35))
        }

        // PT-BR boost — Brazilian-Portuguese content is highest editorial priority for @brand
        const PT_BR_SIGNALS = [
          'eletroposto', 'frota elétrica', 'frota eletrica', 'veículo elétrico',
          'veiculo eletrico', 'carro elétrico', 'carro eletrico', 'recarga rápida',
          'recarga rapida', 'brasil', 'brasileir', 'abve', 'abeev', 'emob brasil',
          'isenção', 'isencao', 'mobilidade elétrica', 'mobilidade eletrica',
          // Marcas com operações brasileiras
          'byd brasil', 'hyundai brasil', 'kia brasil', 'tesla brasil',
          'ford brasil', 'mercedes brasil', 'stellantis brasil', 'intelbras',
          'weg ', 'emob brasil',
          // Contexto geográfico e institucional
          'são paulo', 'sao paulo', 'rio de janeiro', 'curitiba', 'brasília', 'brasilia',
          'governo federal', 'governo estado', 'prefeitura', 'proconve', 'contran',
          'aneel', 'antt', 'denatran', 'senatran',
          // Incentivos e financeiro
          'financiamento ev', 'leilão energia', 'leilao energia', 'crédito ev', 'credito ev',
          'incentivo fiscal ev', 'programa brasileiro',
        ]
        if (PT_BR_SIGNALS.some(term => textLower.includes(term))) {
          adjustedScore = Math.min(100, Math.round(adjustedScore * 1.50))
        }
      }

      // Optimization 10: Author reach feedback — aprende do reach real dos nossos reels.
      // Autores que historicamente renderam mais alcance sobem; alto-volume/baixo-reach descem.
      const authorWeight = authorReachWeights.get((t.authorHandle ?? '').toLowerCase()) ?? 1
      if (authorWeight !== 1) {
        adjustedScore = Math.min(100, Math.round(adjustedScore * authorWeight))
      }

      // Optimization 11 (AI&Tech workspace only): CTA content boost (+12 flat).
      // Posts que oferecem recurso distribuível (repo, guia, lista, template) em troca de
      // comentário/DM sobem naturalmente na fila — o Writer fecha ~1 em 4 com o gatilho.
      let ctaContent = false
      if (!features.ev_market_curation) {
        ctaContent = CTA_BOOST_PATTERNS.some(p => textLower.includes(p))
        if (ctaContent) {
          adjustedScore = Math.min(100, adjustedScore + 12)
        }
      }

      return {
        ...t,
        virality: { ...virality, score: adjustedScore },
        ctaContent,
      }
    })

    rankedTweets.sort((a, b) => b.virality.score - a.virality.score)

    // ── 3. Take top N — filter brand-rejected (score = 0) + enforce source diversity ──
    const maxResults = Number(ctx.settings?.curator_max_results ?? 50)
    const maxPerAuthor = await getNumericVariable(ctx.workspaceId, 'curator_max_per_author') || 2
    const _authorCounts: Record<string, number> = {}
    const topTweets = rankedTweets
      .filter(t => t.virality.score > 0)
      .filter(t => {
        const key = t.authorHandle || 'unknown'
        _authorCounts[key] = (_authorCounts[key] ?? 0) + 1
        return _authorCounts[key] <= maxPerAuthor
      })
      .slice(0, maxResults)

    // ── 4. Dedup against existing curated_content (batch load + exact URL + Jaccard) ──
    // Threshold raised to 0.85: 0.5 was treating "same topic" as "duplicate content",
    // causing new product launches (e.g. GPT-5.5) to be skipped because they share
    // keywords (gpt, openai, model) with prior content already in the 48h window.
    const dedupThreshold = Number(ctx.settings?.dedup_similarity_threshold ?? 0.85)
    const dedupWindowHours = Number(ctx.settings?.dedup_window_hours ?? 48)
    // Trending tweets use a shorter window + higher threshold to allow multiple angles of the same topic
    const trendingDedupWindowHours = Number(ctx.settings?.trending_dedup_window_hours ?? 4)
    const trendingDedupThreshold = Number(ctx.settings?.trending_dedup_threshold ?? 0.85)
    const rowsToInsert: Array<Record<string, unknown>> = []

    // Batch load existing fingerprints + source URLs for exact-match dedup
    const windowStart = new Date(Date.now() - dedupWindowHours * 60 * 60 * 1000).toISOString()
    const trendingWindowStart = new Date(Date.now() - trendingDedupWindowHours * 60 * 60 * 1000).toISOString()
    const { data: existingContent } = await supabase
      .from('curated_content')
      .select('id, keyword_fingerprint, created_at, source_url')
      .eq('workspace_id', ctx.workspaceId)
      .gte('created_at', windowStart)

    type FpRow = { id: string; keyword_fingerprint: string[]; created_at: string; source_url: string | null }
    const allExisting = (existingContent ?? []) as FpRow[]
    const existingUrls = new Set(allExisting.map(c => c.source_url).filter(Boolean))

    const toFpPool = (items: FpRow[]) =>
      items.filter(c => c.keyword_fingerprint?.length > 0)
           .map(c => ({ id: c.id, fingerprint: c.keyword_fingerprint }))

    const existingFingerprints = toFpPool(allExisting)
    const trendingFingerprints = toFpPool(allExisting.filter(c => c.created_at >= trendingWindowStart))

    for (const tweet of topTweets) {
      try {
        // Exact URL dedup — same tweet already ingested, skip immediately
        if (tweet.tweetUrl && existingUrls.has(tweet.tweetUrl)) continue

        // Trending tweets check against a shorter window with a stricter threshold,
        // so multiple different angles of the same hot topic can pass through.
        const pool = tweet.source === 'trending' ? trendingFingerprints : existingFingerprints
        const threshold = tweet.source === 'trending' ? trendingDedupThreshold : dedupThreshold

        // Jaccard similarity — only blocks near-identical text, not same-topic content
        const newFp = extractKeywordFingerprint(tweet.text)
        const isDuplicate = pool.some(existing => {
          const set1 = new Set(newFp)
          const set2 = new Set(existing.fingerprint)
          let intersection = 0
          for (const term of set1) { if (set2.has(term)) intersection++ }
          const union = set1.size + set2.size - intersection
          return union > 0 && (intersection / union) >= threshold
        })
        if (isDuplicate) continue

        // Classify content category based on keywords (lightweight, no AI call)
        const textLower = tweet.text.toLowerCase()
        let category = 'news'
        if (features.ev_market_curation) {
          // EV B2B taxonomy — more actionable for the writer than generic AI categories
          if (/ocpp|ccs2|chademo|mennekes|sae j1772|v2g|v2h|v2b|smart charging|load balanc|peak shav|demand response/.test(textLower)) category = 'ev_technical'
          else if (/frota|fleet|frot[a]|frotas|gestão de frota|gestao de frota|corporate ev|commercial ev|empresa|b2b/.test(textLower)) category = 'ev_fleet'
          else if (/eletroposto|charging station|charging infra|charging network|ponto de recarga|condom[ií]nio|shopping|parking|workplace|estacion/.test(textLower)) category = 'ev_infrastructure'
          else if (/isenção|isencao|incentivo|regulação|regulacao|legislação|legislacao|política|politica|lei |decreto|norma|abnt|inmetro|subsídio|subsidio/.test(textLower)) category = 'ev_regulatory'
          else if (/brasil|brasileir|lançamento|lancamento|disponível|disponivel|chegou|novo model|novo carro|nova versão/.test(textLower)) category = 'ev_market_br'
          else if (/launching|lançou|launch|announced|disponível today|introducing|novo lançamento|new model|new ev/.test(textLower)) category = 'ev_launch'
          else category = 'ev_news'
        } else {
          if (/introducing|announcing|available today|releasing|launching|we.re releasing/.test(textLower)) category = 'launch'
          else if (/leak|found.*endpoint|reverse.engineer|screenshot.*api|unreleased/.test(textLower)) category = 'leak'
          else if (/arxiv|paper|research|we show that|our findings/.test(textLower)) category = 'paper'
          else if (/benchmark|sota|outperforms|beats|chatbot arena|swe-bench|mmlu/.test(textLower)) category = 'benchmark'
          else if (/raised|series [a-f]|acquired|valuation|ipo|funding/.test(textLower)) category = 'business'
          else if (/i built|i just built|here.s how|step by step|workflow|tutorial|automates/.test(textLower)) category = 'workflow_showcase'
          else if (/imo|hot take|opinion|thread|unpopular|controversial/.test(textLower)) category = 'opinion'
        }

        const isBreaking = ['launch', 'leak', 'benchmark', 'ev_launch', 'ev_regulatory'].includes(category) && tweet.virality.score >= 80

        rowsToInsert.push({
          workspace_id: ctx.workspaceId,
          source_platform: 'x',
          source_url: tweet.tweetUrl,
          source_author: tweet.authorHandle,
          source_content: tweet.text,
          relevance_score: tweet.virality.score,
          keyword_fingerprint: extractKeywordFingerprint(tweet.text),
          score_breakdown: {
            category,
            is_breaking: isBreaking,
            source: tweet.source,
            virality_score: tweet.virality.score,
            cta_content: tweet.ctaContent ?? false,
            classified_at: new Date().toISOString(),
            brazil_scoped: tweet.brazilScoped ?? false,
          },
          source_metrics: {
            source: tweet.source,
            likes: tweet.metrics.likes,
            retweets: tweet.metrics.retweets,
            replies: tweet.metrics.replies,
            views: tweet.metrics.views,
            author_followers: tweet.authorFollowers ?? 0,
            has_media: tweet.hasMedia,
            media_urls: tweet.mediaUrls,
            media_types: tweet.mediaTypes,
            video_url: tweet.videoUrl ?? null,
            tweet_id: tweet.id,
            reel_eligible: (
              Array.isArray(tweet.mediaTypes) &&
              tweet.mediaTypes.includes('video') &&
              tweet.virality.score >= reelMinRelevanceScore &&
              isTopicRelevant(tweet.text, features.ev_market_curation)
            ),
            virality: {
              score: tweet.virality.score,
              tier: tweet.virality.tier,
              dimensions: tweet.virality.dimensions,
              keywordsMatched: tweet.virality.breakdown.keywordsMatched,
            },
          },
          status: 'curated',
          pipeline_run_id: ctx.pipelineRunId ?? null,
        })
      } catch (err) {
        errors.push(`Dedup check failed for tweet ${tweet.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── Source 4: YouTube channels + keyword search (Brand only) ──────────
    // Quota budget: 10,000u/day free. Each search = 100u.
    // Strategy: max 8 channels per run (oldest first), each re-checked after 24h.
    //           keyword search gated to once every 12h.
    //           Stop immediately on first 403 to avoid spam.
    if (features.ev_market_curation) {
      try {
        const ytChannelsPerRun = 8
        const ytChannelStaleMs = 24 * 60 * 60 * 1000  // 24h between checks per channel
        const ytCutoff = new Date(Date.now() - ytChannelStaleMs).toISOString()

        const { data: ytProfiles } = await supabase
          .from('monitor_sources')
          .select('id, handle, feed_url, last_checked_at')
          .eq('workspace_id', ctx.workspaceId)
          .eq('platform', 'youtube')
          .eq('active', true)
          .or(`last_checked_at.is.null,last_checked_at.lt.${ytCutoff}`)
          .order('last_checked_at', { ascending: true, nullsFirst: true })
          .limit(ytChannelsPerRun)

        let ytQuotaExhausted = false
        for (const profile of (ytProfiles ?? []) as Array<{ id: string; handle: string; feed_url: string | null; last_checked_at: string | null }>) {
          if (ytQuotaExhausted) break
          try {
            // Resolve @handle → UCxxx on first encounter; save resolved ID so it's used directly next time
            let resolvedChannelId = profile.handle
            if (!profile.handle.startsWith('UC')) {
              const resolved = await resolveChannelHandle(profile.handle)
              if (!resolved) {
                errors.push(`YouTube: não foi possível resolver handle ${profile.handle}`)
                continue
              }
              await supabase.from('monitor_sources').update({ handle: resolved }).eq('id', profile.id)
              resolvedChannelId = resolved
            }
            const videos = await getChannelLatestVideos(resolvedChannelId, profile.feed_url ?? undefined, 5)
            await supabase.from('monitor_sources').update({ last_checked_at: new Date().toISOString() }).eq('id', profile.id)
            if (videos.length > 0) {
              await supabase.from('monitor_sources').update({ feed_url: videos[0].videoId }).eq('id', profile.id)
            }
            for (const video of videos) {
              if (existingUrls.has(video.videoUrl)) continue
              const text = `${video.title}\n\n${video.description}`
              if (!isTopicRelevant(text, features.ev_market_curation)) continue
              rowsToInsert.push({
                workspace_id: ctx.workspaceId,
                source_platform: 'youtube',
                source_url: video.videoUrl,
                source_author: video.channelTitle,
                source_content: text,
                relevance_score: 55,
                keyword_fingerprint: extractKeywordFingerprint(text),
                score_breakdown: { category: 'news', source: 'youtube_channel', classified_at: new Date().toISOString() },
                source_metrics: { source: 'youtube_channel', videoId: video.videoId, thumbnailUrl: video.thumbnailUrl, channelTitle: video.channelTitle, channelId: video.channelId, publishedAt: video.publishedAt, reel_eligible: false },
                status: 'curated',
                pipeline_run_id: ctx.pipelineRunId ?? null,
              })
              existingUrls.add(video.videoUrl)
              sourceCounts.youtube++
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('403') || msg.toLowerCase().includes('quota')) {
              ytQuotaExhausted = true
              errors.push(`YouTube quota exhausted — pausing channel checks until tomorrow`)
            } else {
              errors.push(`YouTube channel ${profile.handle}: ${msg}`)
            }
          }
        }

        // YouTube keyword search — gated to once every 12h to conserve quota
        if (!ytQuotaExhausted) {
          const ytSearchLastRanStr = await getVariable(ctx.workspaceId, 'youtube_search_last_ran_at')
          const ytSearchLastRan = ytSearchLastRanStr ? new Date(ytSearchLastRanStr).getTime() : 0
          const shouldRunYtSearch = Date.now() - ytSearchLastRan > 12 * 60 * 60 * 1000

          if (shouldRunYtSearch) {
            await supabase.from('workspace_settings').upsert(
              { workspace_id: ctx.workspaceId, category: 'curator', key: 'youtube_search_last_ran_at', value: new Date().toISOString() },
              { onConflict: 'workspace_id,category,key' }
            )
            const ytQueriesRaw = await getVariable(ctx.workspaceId, 'youtube_search_queries')
            const ytQueries: string[] = ytQueriesRaw ? (JSON.parse(ytQueriesRaw) as string[]) : []
            for (const q of ytQueries.slice(0, 5)) {
              if (ytQuotaExhausted) break
              try {
                const videos = await searchYouTubeVideos(q, 10, ageCutoff)
                for (const video of videos) {
                  if (existingUrls.has(video.videoUrl)) continue
                  const text = `${video.title}\n\n${video.description}`
                  if (!isTopicRelevant(text, features.ev_market_curation)) continue
                  rowsToInsert.push({
                    workspace_id: ctx.workspaceId,
                    source_platform: 'youtube',
                    source_url: video.videoUrl,
                    source_author: video.channelTitle,
                    source_content: text,
                    relevance_score: 50,
                    keyword_fingerprint: extractKeywordFingerprint(text),
                    score_breakdown: { category: 'news', source: 'youtube_search', classified_at: new Date().toISOString() },
                    source_metrics: { source: 'youtube_search', videoId: video.videoId, thumbnailUrl: video.thumbnailUrl, channelTitle: video.channelTitle, channelId: video.channelId, publishedAt: video.publishedAt, reel_eligible: false },
                    status: 'curated',
                    pipeline_run_id: ctx.pipelineRunId ?? null,
                  })
                  existingUrls.add(video.videoUrl)
                  sourceCounts.youtube++
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                if (msg.includes('403') || msg.toLowerCase().includes('quota')) {
                  ytQuotaExhausted = true
                  errors.push(`YouTube quota exhausted during search — pausing until tomorrow`)
                } else {
                  errors.push(`YouTube search "${q}": ${msg}`)
                }
              }
            }
          }
        }
      } catch (err) {
        errors.push(`YouTube source: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── Source 5: Instagram account monitoring (Brand only) ─────────────
    const igRowsForArchive: Array<Record<string, unknown>> = []
    if (features.ev_market_curation) {
      try {
        const igCreds = await getInstagramCredentials(ctx.workspaceId)
        const { data: igProfiles } = await supabase
          .from('monitor_sources')
          .select('id, handle, last_checked_at')
          .eq('workspace_id', ctx.workspaceId)
          .eq('platform', 'instagram')
          .eq('active', true)

        for (const profile of (igProfiles ?? []) as Array<{ id: string; handle: string; last_checked_at: string | null }>) {
          try {
            const reels = await getInstagramAccountReels(
              igCreds.igUserId,
              igCreds.accessToken,
              profile.handle,
              profile.last_checked_at ?? undefined,
            )
            await supabase.from('monitor_sources').update({ last_checked_at: new Date().toISOString() }).eq('id', profile.id)

            for (const reel of reels) {
              if (existingUrls.has(reel.permalink)) continue
              const isRelevant = isTopicRelevant(reel.caption, features.ev_market_curation)
              const row: Record<string, unknown> = {
                workspace_id: ctx.workspaceId,
                source_platform: 'instagram',
                source_url: reel.permalink,
                source_author: reel.username,
                source_content: reel.caption,
                relevance_score: isRelevant ? 50 : 20,
                keyword_fingerprint: extractKeywordFingerprint(reel.caption),
                score_breakdown: { category: 'news', source: 'instagram_profile', classified_at: new Date().toISOString() },
                source_metrics: { source: 'instagram_profile', mediaId: reel.mediaId, thumbnailUrl: reel.thumbnailUrl, video_url: reel.mediaUrl, timestamp: reel.timestamp, reel_eligible: true },
                status: 'curated',
                pipeline_run_id: ctx.pipelineRunId ?? null,
              }
              rowsToInsert.push(row)
              igRowsForArchive.push(row)
              existingUrls.add(reel.permalink)
              sourceCounts.instagram++
            }
          } catch (err) {
            errors.push(`Instagram @${profile.handle}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      } catch (err) {
        errors.push(`Instagram source: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── Source 6: RSS/Atom news feeds ─────────────────────────────────────────
    // Generic: any workspace with monitor_sources platform='rss' gets this source.
    // handle = feed URL; feed_url = last-seen article URL (for incremental dedup).
    try {
      const { data: rssFeeds } = await supabase
        .from('monitor_sources')
        .select('id, handle, feed_url')
        .eq('workspace_id', ctx.workspaceId)
        .eq('platform', 'rss')
        .eq('active', true)

      for (const feed of (rssFeeds ?? []) as Array<{ id: string; handle: string; feed_url: string | null }>) {
        try {
          let feedTitle = feed.handle
          try { feedTitle = new URL(feed.handle).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
          const items = await fetchRssFeed(feed.handle, feedTitle, 10)

          // Mark feed as checked
          await supabase.from('monitor_sources').update({ last_checked_at: new Date().toISOString() }).eq('id', feed.id)

          let latestUrl: string | null = null
          for (const item of items) {
            // Skip articles older than ageCutoff
            if (item.pubDate < ageCutoff) continue
            if (existingUrls.has(item.link)) continue
            if (feed.feed_url === item.link) break  // already processed up to here

            const text = `${item.title}\n\n${item.description}`
            if (!isTopicRelevant(text, features.ev_market_curation)) continue

            // Classify EV B2B category for brandmob
            const tl = text.toLowerCase()
            let rssCategory = features.ev_market_curation ? 'ev_news' : 'news'
            if (features.ev_market_curation) {
              if (/ocpp|ccs2|v2g|smart charging|load balanc/.test(tl)) rssCategory = 'ev_technical'
              else if (/frota|fleet|corporate ev|commercial ev/.test(tl)) rssCategory = 'ev_fleet'
              else if (/eletroposto|charging station|charging infra|condom[ií]nio|parking/.test(tl)) rssCategory = 'ev_infrastructure'
              else if (/isenção|isencao|incentivo|regulação|legislação|lei |decreto/.test(tl)) rssCategory = 'ev_regulatory'
              else if (/brasil|lançamento|lancamento|novo model|nova versão/.test(tl)) rssCategory = 'ev_market_br'
              else if (/launching|launch|announced|new ev|new model/.test(tl)) rssCategory = 'ev_launch'
            } else {
              if (/announcing|launching|introducing|available today/.test(tl)) rssCategory = 'launch'
            }

            rowsToInsert.push({
              workspace_id: ctx.workspaceId,
              source_platform: 'rss',
              source_url: item.link,
              source_author: item.author || feedTitle,
              source_content: text,
              relevance_score: 55,
              keyword_fingerprint: extractKeywordFingerprint(text),
              score_breakdown: { category: rssCategory, source: 'rss_feed', feed_title: feedTitle, classified_at: new Date().toISOString() },
              source_metrics: { source: 'rss_feed', feed_url: feed.handle, feed_title: feedTitle, pub_date: item.pubDate.toISOString(), reel_eligible: false },
              status: 'curated',
              pipeline_run_id: ctx.pipelineRunId ?? null,
            })
            existingUrls.add(item.link)
            sourceCounts.rss++
            if (!latestUrl) latestUrl = item.link  // first item = most recent
          }

          // Save most-recent article URL for incremental dedup on next run
          if (latestUrl) {
            await supabase.from('monitor_sources').update({ feed_url: latestUrl }).eq('id', feed.id)
          }
        } catch (err) {
          errors.push(`RSS ${feed.handle}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      errors.push(`RSS source: ${err instanceof Error ? err.message : String(err)}`)
    }

    // ── 5. Breaking news cluster detection ──
    // If 4+ independent posts mention the same trending term in 4h → breaking news
    if (rowsToInsert.length > 0 && trendingTerms.size > 0) {
      const clusterWindowStart = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      const breakingTerms = new Set<string>()

      // Group current batch by trending term
      const batchByTerm = new Map<string, number>()
      for (const r of rowsToInsert) {
        const term = (r.score_breakdown as Record<string, unknown> | undefined)?.trending_term as string | undefined
        if (term) batchByTerm.set(term, (batchByTerm.get(term) || 0) + 1)
      }

      for (const [term, batchCount] of batchByTerm) {
        const { count: existingCount } = await supabase
          .from('curated_content')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ctx.workspaceId)
          .gte('created_at', clusterWindowStart)
          .ilike('source_content', `%${term}%`)

        if ((existingCount || 0) + batchCount >= 4) {
          breakingTerms.add(term)
          console.log(`[curator] 🚨 BREAKING NEWS cluster: "${term}" — ${(existingCount || 0) + batchCount} posts em 4h`)
        }
      }

      if (breakingTerms.size > 0) {
        for (const r of rowsToInsert) {
          const term = (r.score_breakdown as Record<string, unknown> | undefined)?.trending_term as string | undefined
          if (term && breakingTerms.has(term)) {
            r.score_breakdown = { ...(r.score_breakdown as object), breaking_news: true }
          }
        }
      }
    }

    // ── 5b. Enriquecer candidatos YouTube com engajamento JÁ ALCANÇADO ──
    // source_metrics de vídeos do YouTube não tinha view/like/comment count
    // (achado 2026-07-11) — nada podia ser validado como "já viral" nesse
    // source_platform. Best-effort: falha aqui não bloqueia a curadoria.
    const youtubeRows = rowsToInsert.filter(r => r.source_platform === 'youtube')
    if (youtubeRows.length > 0) {
      try {
        const videoIds = youtubeRows
          .map(r => (r.source_metrics as Record<string, unknown>)?.videoId as string | undefined)
          .filter((id): id is string => !!id)
        const stats = await getVideoStatistics(videoIds)
        for (const row of youtubeRows) {
          const sm = row.source_metrics as Record<string, unknown>
          const videoId = sm?.videoId as string | undefined
          const stat = videoId ? stats[videoId] : undefined
          if (stat) {
            row.source_metrics = { ...sm, viewCount: stat.viewCount, likeCount: stat.likeCount, commentCount: stat.commentCount }
          }
        }
      } catch (err) {
        errors.push(`YouTube statistics enrichment failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── 6. Insert into curated_content ──
    if (rowsToInsert.length > 0) {
      try {
        const { error: insertError } = await supabase.from('curated_content').insert(rowsToInsert as unknown as TablesInsert<'curated_content'>[])
        if (insertError) {
          errors.push(`Insert failed: ${insertError.message}`)
        } else {
          totalCurated = rowsToInsert.length

          // ── 6b. Archive reel-eligible videos to Supabase Storage ──────────
          // Twitter video URLs expire in ~48h. Downloading immediately gives us
          // a permanent URL so reels can be produced 1-7 days after curation.
          if (features.video_reels) {
            const reelRows = rowsToInsert.filter(r => {
              const sm = r.source_metrics as Record<string, unknown>
              return sm?.reel_eligible === true && sm?.video_url
            })
            if (reelRows.length > 0) {
              await Promise.allSettled(reelRows.map(async row => {
                const sm = row.source_metrics as Record<string, unknown>
                const videoUrl = sm.video_url as string
                const tweetId = sm.tweet_id as string
                try {
                  const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) })
                  if (!videoRes.ok) return
                  const videoBuffer = Buffer.from(await videoRes.arrayBuffer())
                  const storedPath = `videos/${tweetId}.mp4`
                  const { error: uploadErr } = await supabase.storage
                    .from('brand-assets')
                    .upload(storedPath, videoBuffer, { contentType: 'video/mp4', upsert: true })
                  if (uploadErr) { console.error(`[curator] Video upload failed ${tweetId}:`, uploadErr.message); return }
                  const storedVideoUrl = supabase.storage.from('brand-assets').getPublicUrl(storedPath).data.publicUrl
                  await supabase.from('curated_content')
                    .update({ source_metrics: { ...(sm as object), stored_video_url: storedVideoUrl } })
                    .eq('workspace_id', ctx.workspaceId)
                    .eq('source_url', row.source_url as string)
                  console.log(`[curator] ✅ Archived reel video ${tweetId} → ${storedPath}`)
                } catch (err) {
                  console.error(`[curator] Video archive failed ${tweetId}:`, err instanceof Error ? err.message : err)
                }
              }))
            }
          }

          // ── 6c. Archive Instagram reel videos ─────────────────────────────
          if (igRowsForArchive.length > 0) {
            await Promise.allSettled(igRowsForArchive.map(async row => {
              const sm = row.source_metrics as Record<string, unknown>
              const videoUrl = sm.video_url as string
              const mediaId = sm.mediaId as string
              try {
                const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) })
                if (!videoRes.ok) return
                const videoBuffer = Buffer.from(await videoRes.arrayBuffer())
                const storedPath = `videos/ig-${mediaId}.mp4`
                const { error: uploadErr } = await supabase.storage
                  .from('brand-assets')
                  .upload(storedPath, videoBuffer, { contentType: 'video/mp4', upsert: true })
                if (uploadErr) { console.error(`[curator] IG video upload failed ${mediaId}:`, uploadErr.message); return }
                const storedVideoUrl = supabase.storage.from('brand-assets').getPublicUrl(storedPath).data.publicUrl
                await supabase.from('curated_content')
                  .update({ source_metrics: { ...(sm as object), stored_video_url: storedVideoUrl } })
                  .eq('workspace_id', ctx.workspaceId)
                  .eq('source_url', row.source_url as string)
                console.log(`[curator] ✅ Archived IG reel ${mediaId} → ${storedPath}`)
              } catch (err) {
                console.error(`[curator] IG video archive failed ${mediaId}:`, err instanceof Error ? err.message : err)
              }
            }))
          }

          // ── 6. Push curated batch to v2.1 (social-machine-claude) ──
          const webhookUrl = process.env.SOCIAL_MACHINE_WEBHOOK_URL
          const webhookSecret = process.env.SOCIAL_MACHINE_WEBHOOK_SECRET
          if (webhookUrl && webhookSecret) {
            const payload = rowsToInsert.map(r => ({
              source_url: r.source_url,
              source_author: r.source_author,
              source_content: r.source_content,
              source_platform: r.source_platform,
              relevance_score: r.relevance_score,
              source_metrics: r.source_metrics,
            }))
            fetch(`${webhookUrl}/api/hooks/ingest-curated`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${webhookSecret}`,
              },
              body: JSON.stringify({ items: payload }),
            }).then(res => {
              if (!res.ok) errors.push(`Webhook v2.1 respondeu ${res.status}: ${webhookUrl}`)
            }).catch(err => {
              errors.push(`Webhook v2.1 falhou: ${err instanceof Error ? err.message : String(err)}`)
            })
          }
        }
      } catch (err) {
        errors.push(`Insert failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return {
      success: totalCurated > 0 || errors.length === 0,
      itemsProcessed: allTweets.length,
      itemsProduced: totalCurated,
      errors,
      tokensUsed: 0,
      costEstimate: 0,
      durationMs: Date.now() - startTime,
      details: {
        sourceCounts,
        trendingMatched,
        profileCounts,
        totalFetched: allTweets.length,
        uniqueTweets: uniqueTweets.length,
        contentCurated: totalCurated,
        duplicatesSkipped: topTweets.length - rowsToInsert.length,
      },
    }
  }

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const curated = (d.contentCurated as number) ?? 0
    const fetched = (d.totalFetched as number) ?? 0
    return {
      agentSlug: 'curator',
      inputSummary: `3 sources, ${fetched} tweets fetched`,
      outputSummary: `${curated} real tweets curated`,
      autoScore: curated >= 10 ? 9 : curated >= 5 ? 7 : curated > 0 ? 5 : 3,
      dimensions: {
        coverage: curated >= 8 ? 9 : curated >= 3 ? 6 : 3,
        quality: curated > 0 ? 8 : 2,
        dedup: ((d.duplicatesSkipped as number) ?? 0) > 0 ? 8 : 10,
      },
      issues: result.errors,
      verdict: curated > 0 ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>
    if (!result.success && result.itemsProduced === 0) {
      return `❌ *Curador* — Erro: ${result.errors[0] ?? 'Unknown error'}`
    }

    const sourceCounts = (d.sourceCounts as Record<string, number>) ?? {}
    const trendingMatched = (d.trendingMatched as string[]) ?? []
    const profileCounts = (d.profileCounts as Record<string, number>) ?? {}

    const lines = [
      '📋 *Curador — Tweets Reais Coletados*',
      '',
      `🌐 ${d.totalFetched} tweets buscados → ${d.contentCurated} curados (${d.duplicatesSkipped} duplicados ignorados)`,
      '',
    ]

    // Source 1: Trending
    const trendingMatchStr = trendingMatched.length > 0
      ? ` (matched: ${trendingMatched.map(t => `"${t}"`).join(', ')})`
      : ''
    lines.push(`📈 Trending: ${sourceCounts.trending ?? 0} tweets${trendingMatchStr}`)

    // Source 2: Profiles
    const profileEntries = Object.entries(profileCounts)
    const profileDetail = profileEntries.length > 0
      ? ` (${profileEntries.map(([h, c]) => `@${h}: ${c}`).join(', ')})`
      : ''
    lines.push(`👤 Perfis: ${sourceCounts.profile ?? 0} tweets${profileDetail}`)

    // Source 3: Keywords
    lines.push(`🔍 Keywords: ${sourceCounts.keyword ?? 0} tweets`)

    // Source 4: YouTube
    if ((sourceCounts.youtube ?? 0) > 0) {
      lines.push(`📺 YouTube: ${sourceCounts.youtube} vídeos`)
    }

    // Source 5: Instagram
    if ((sourceCounts.instagram ?? 0) > 0) {
      lines.push(`📸 Instagram: ${sourceCounts.instagram} reels`)
    }

    if (result.errors.length > 0) {
      lines.push('')
      lines.push(`⚠️ ${result.errors.length} erro(s): ${result.errors[0].slice(0, 100)}`)
    }

    lines.push('')
    lines.push(`⏱️ ${(result.durationMs / 1000).toFixed(1)}s | 🪙 0 tokens (real data, no AI)`)

    return lines.join('\n')
  }
}

/**
 * Check if tweet text contains a URL.
 * t.co links are allowed because they're shortened external URLs.
 * Only pure twitter.com/x.com links (profile links, status links) are excluded.
 */
function hasExternalUrl(text: string): boolean {
  const urlRegex = /https?:\/\/\S+/g
  const urls = text.match(urlRegex) ?? []
  return urls.some(url => {
    const lower = url.toLowerCase()
    if (lower.includes('t.co/')) return true
    if (lower.includes('twitter.com') || lower.includes('x.com')) return false
    return true
  })
}

export const agent = new CuratorAgent()
