/**
 * Radar IA — Structured queries for viral tweet discovery.
 * Source: RADAR_IA_KNOWLEDGE.md
 * Used by curator Source 1 (viral discovery) via TwitterAPI.io or X API.
 */

export interface RadarQuery {
  id: string
  name: string
  query: string
  pollSeconds: number
  description: string
  /** Query is scoped to the Brazilian market (lang:pt or Brazilian-brand accounts). Used to
   * prioritize Brazil content over global EV content for Brand (2026-07-06). */
  brazilScoped?: boolean
}

export const RADAR_QUERIES: RadarQuery[] = [
  {
    id: 'breaking-labs',
    name: 'Breaking labs',
    query: '(from:OpenAI OR from:sama OR from:AnthropicAI OR from:GoogleDeepMind OR from:deepseek_ai OR from:xai OR from:AIatMeta OR from:MistralAI) ("introducing" OR "announcing" OR "available today" OR "releasing") -filter:replies',
    pollSeconds: 60,
    description: 'Anúncios oficiais dos labs de fronteira',
  },
  {
    id: 'leaks-rumors',
    name: 'Leaks e rumores',
    query: '(from:testingcatalog OR from:apples_jimmy OR from:btibor91 OR from:minchoi OR from:rowancheung OR from:AndrewCurran_) -filter:replies -filter:retweets',
    pollSeconds: 60,
    description: 'Insiders que vazam features antes do anúncio',
  },
  {
    id: 'claude-anthropic',
    name: 'Claude/Anthropic (TOP PRIORITY)',
    query: '("Claude" OR "Anthropic" OR "Claude Code" OR "Claude Sonnet" OR "Claude Opus") min_faves:30 -filter:replies',
    pollSeconds: 120,
    description: 'Qualquer menção viral a Claude/Anthropic',
  },
  {
    id: 'new-model',
    name: 'Novo modelo com magnitude',
    query: '("new model" OR "model release" OR "open sourcing") ("SOTA" OR "outperforms" OR "beats GPT" OR "beats Claude") min_faves:100 -filter:replies lang:en',
    pollSeconds: 300,
    description: 'Lançamentos com sinal de magnitude competitiva',
  },
  {
    id: 'china-breaking',
    name: 'China breaking',
    query: '(DeepSeek OR Qwen OR Kimi OR GLM OR Hunyuan OR MiniMax) min_faves:50 -filter:replies',
    pollSeconds: 300,
    description: 'Lançamentos dos labs chineses',
  },
  {
    id: 'benchmark-moves',
    name: 'Benchmark moves',
    query: '("Chatbot Arena" OR "SWE-bench" OR "ARC-AGI" OR "LiveBench" OR "MMLU") ("#1" OR "new SOTA" OR "beats" OR "surpasses") min_faves:50 -filter:replies',
    pollSeconds: 300,
    description: 'Mudanças de liderança em benchmarks',
  },
  {
    id: 'viral-ai-media',
    name: 'Viral AI com mídia',
    query: '("AI" OR "artificial intelligence" OR "GPT" OR "Claude" OR "Gemini") min_faves:300 -filter:replies has:media',
    pollSeconds: 300,
    description: 'Vídeos e imagens virais sobre IA',
  },
  {
    id: 'brasil-launches',
    name: 'Brasil AI',
    query: '("lançamos" OR "acabou de lançar" OR "disponível") ("IA" OR "inteligência artificial" OR GPT OR Claude) lang:pt min_faves:20',
    pollSeconds: 900,
    description: 'Lançamentos IA no Brasil',
  },
  {
    id: 'workflow-showcase',
    name: 'Workflows e tutoriais',
    query: '("I just built" OR "I built" OR "here\'s how" OR "step by step" OR "fully automated" OR "workflow" OR "runs on autopilot") ("Claude" OR "n8n" OR "Cursor" OR "Lovable" OR "Bolt" OR "Sora" OR "Veo" OR "MCP") min_faves:50 has:media -filter:replies',
    pollSeconds: 600,
    description: 'Demos de workflow e tutoriais práticos com ferramentas AI',
  },
  {
    id: 'ai-tools-combo',
    name: 'Combos de ferramentas',
    query: '("Claude" OR "Sonnet" OR "Opus") ("n8n" OR "Zapier" OR "Make" OR "Cursor" OR "Lovable") min_faves:30 -filter:replies',
    pollSeconds: 600,
    description: 'Combinações de ferramentas AI em uso real',
  },
]

// ── EV Radar — queries for Brand workspace ────────────────────────────────
// CHINESE WALL: These queries are EV/energy focused. Never use RADAR_QUERIES for brandmob.
export const RADAR_QUERIES_EV: RadarQuery[] = [
  {
    id: 'ev-breaking-brands',
    name: 'Marcas EV — breaking',
    query: '(from:Tesla OR from:BYDCompany OR from:Rivian OR from:LucidMotors OR from:PolestarCars) -filter:replies has:media',
    pollSeconds: 300,
    description: 'Anúncios oficiais das principais marcas EV (fabricantes apenas — operadoras concorrentes removidas)',
  },
  {
    id: 'ev-fleet-corporate',
    name: 'Frotas corporativas EV',
    query: '("fleet electrification" OR "electric fleet" OR "EV fleet" OR "fleet charging" OR "commercial EV") min_faves:50 has:media -filter:replies',
    pollSeconds: 300,
    description: 'Frotas elétricas corporativas e gestão de recarga B2B',
  },
  {
    id: 'ev-charging-infra',
    name: 'Infraestrutura de recarga',
    query: '("EV charging station" OR "DC fast charging" OR "fast charger" OR "charging infrastructure" OR "charging network") min_faves:80 has:media -filter:replies',
    pollSeconds: 300,
    description: 'Infraestrutura de carregamento EV viral',
  },
  {
    id: 'ev-bess-solar',
    name: 'BESS e solar EV',
    query: '("BESS" OR "battery storage" OR "energy storage system" OR "solar charging" OR "V2G" OR "vehicle to grid") ("EV" OR "electric vehicle" OR "fleet") min_faves:50 has:media -filter:replies',
    pollSeconds: 600,
    description: 'Armazenamento de energia e solar integrado com EV',
  },
  {
    id: 'ev-brasil-pt',
    name: 'EV Brasil PT-BR',
    query: '("eletroposto" OR "frota elétrica" OR "mobilidade elétrica" OR "veículo elétrico" OR "carro elétrico" OR "recarga rápida") lang:pt min_faves:10 has:media',
    pollSeconds: 600,
    description: 'Mercado EV brasileiro em português',
    brazilScoped: true,
  },
  {
    id: 'ev-b2b-property',
    name: 'EV B2B imóveis',
    query: '("EV charging" OR "electric vehicle charging") ("condominium" OR "parking" OR "shopping" OR "commercial building" OR "workplace") min_faves:50 has:media -filter:replies',
    pollSeconds: 900,
    description: 'EV em condomínios, estacionamentos e propriedades comerciais',
  },
  {
    id: 'ev-brasil-b2b',
    name: 'EV B2B Brasil — condomínio e frota',
    query: '("eletroposto condomínio" OR "eletroposto condominio" OR "eletroposto shopping" OR "frota elétrica empresa" OR "instalação eletroposto" OR "ponto de recarga corporativo") lang:pt min_faves:5 has:media',
    pollSeconds: 600,
    description: 'B2B EV brasileiro: eletroposto em condomínios, shoppings e frotas corporativas',
    brazilScoped: true,
  },
  {
    id: 'ev-brasil-marcas',
    name: 'Marcas EV no Brasil',
    query: '(from:BYDAutoBrasil OR from:BrasilBYD OR from:HyundaiBrasil OR from:KiaBrasil OR from:FordBrasil OR from:MercedesBenzBR OR from:VWdoBrasil OR from:StellantisLatam) -filter:replies has:media',
    pollSeconds: 300,
    description: 'Contas brasileiras de fabricantes EV (operadores concorrentes ChargersBrasil/WallboxLatam removidos)',
    brazilScoped: true,
  },
]
