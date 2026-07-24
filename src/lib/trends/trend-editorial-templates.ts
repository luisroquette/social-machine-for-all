export interface TrendEditorialTemplate {
  id: string
  label: string
  creativeAngle: string
  vibeBoost: string
  worldBoost: string
  stylePresets: string[]
  hookTemplates: string[]
  coverTemplates: string[]
  categories: string[]
  keywordPattern?: RegExp
}

const TEMPLATES: TrendEditorialTemplate[] = [
  {
    id: 'ia_inacreditavel',
    label: 'IA inacreditavel',
    creativeAngle: 'mini filme de IA inacreditavel com ruptura visual, escalada tecnica e payoff impossivel',
    vibeBoost: 'assombro tecnologico, ganho de escala, inteligencia fora do normal e sensacao de salto historico',
    worldBoost: 'laboratorio premium, cidade aumentada, hologramas, vidro, metal, energia e interfaces impossiveis',
    stylePresets: ['ultrarealista', 'anime-cinematic', 'abstrato-data', 'cinematic-reveal', 'editorial-premium'],
    hookTemplates: [
      'A IA QUE PARECIA IMPOSSIVEL',
      'NINGUEM ESPERAVA ESSE SALTO DE IA',
      'A CENA DE IA QUE MUDOU O JOGO',
      'O DETALHE QUE FEZ A IA EXPLODIR',
    ],
    coverTemplates: [
      'IA: O SALTO',
      'IA: O CHOQUE',
      'IA: O IMPOSSIVEL',
      'IA: A VIRADA',
    ],
    categories: ['technology'],
    keywordPattern: /\b(ia|ai|claude|chatgpt|gpt|openai|gemini|anthropic|llm|modelo|rob[oô]|avatar|automacao|automação)\b/i,
  },
  {
    id: 'futebol_absurdo',
    label: 'Futebol absurdo',
    creativeAngle: 'mini filme de futebol absurdo com choque de arena, explosao coletiva e consagracao final',
    vibeBoost: 'rivalidade, pressao de estadio, catarse coletiva, choque competitivo e energia de torcida',
    worldBoost: 'gramado, traves, fumaça, torcida, faixas, chuteiras, suor, impacto e flashes de estadio',
    stylePresets: ['ultrarealista', 'anime-stadium', 'abstrato-graphic', 'cinematic-reveal', 'editorial-premium'],
    hookTemplates: [
      'A JOGADA QUE PAROU O BRASIL',
      'NINGUEM VIU ISSO NO FUTEBOL',
      'O CHOQUE QUE VIROU CLIMA DE FINAL',
      'O LANCE QUE MUDOU TUDO',
    ],
    coverTemplates: [
      'FUTEBOL: O CHOQUE',
      'FUTEBOL: A VIRADA',
      'FUTEBOL: O LANCE',
      'FUTEBOL: A FINAL',
    ],
    categories: ['sports'],
    keywordPattern: /\b(futebol|gol|gola[cç]o|flamengo|palmeiras|corinthians|santos|vasco|botafogo|neymar|jorge jesus|libertadores|brasileir[aã]o|copa)\b/i,
  },
  {
    id: 'curiosidade_pop',
    label: 'Curiosidade pop',
    creativeAngle: 'mini filme de curiosidade pop com entrada instantanea, bastidor inesperado e imagem viral final',
    vibeBoost: 'surpresa pop, internet em choque, bastidor revelado e efeito de conversa coletiva',
    worldBoost: 'estudio, backstage, flashes, telas, publico, objetos iconicos e atmosfera de internet em combustao',
    stylePresets: ['ultrarealista', 'anime-cinematic', 'abstrato-neon', 'cinematic-reveal', 'editorial-premium'],
    hookTemplates: [
      'O MOMENTO QUE PAROU A INTERNET',
      'NINGUEM TINHA VISTO ESSE BASTIDOR',
      'A CENA POP QUE VIROU OBSESSAO',
      'O DETALHE QUE TODO MUNDO PERDEU',
    ],
    coverTemplates: [
      'POP: O BASTIDOR',
      'POP: A CENA',
      'POP: O CHOQUE',
      'POP: O DETALHE',
    ],
    categories: ['entertainment', 'pop_culture'],
  },
  {
    id: 'tech_futurista',
    label: 'Tech futurista',
    creativeAngle: 'mini filme tech futurista com ativacao, reconfiguracao do mundo e revelacao heroica',
    vibeBoost: 'futuro proximo, fascinio tecnico, atmosfera premium e promessa de transformacao real',
    worldBoost: 'cidade-laboratorio, vidro, neon frio, drones, interfaces, arquitetura limpa e energia pulsante',
    stylePresets: ['ultrarealista', 'stylized-tech', 'abstrato-data', 'cinematic-reveal', 'luxury-tech'],
    hookTemplates: [
      'A TECNOLOGIA QUE PARECE FILME',
      'O FUTURO CHEGOU MAIS CEDO',
      'NINGUEM ESPERAVA ESSA VIRADA TECH',
      'A REVELACAO TECH QUE MUDOU O JOGO',
    ],
    coverTemplates: [
      'TECH: O FUTURO',
      'TECH: A REVELACAO',
      'TECH: A VIRADA',
      'TECH: O SALTO',
    ],
    categories: ['technology', 'general'],
  },
  {
    id: 'anime_hype',
    label: 'Anime hype',
    creativeAngle: 'mini filme anime hype com escalada absurda, energia exagerada e frame final de culto',
    vibeBoost: 'hype, culto visual, intensidade juvenil, silhueta marcante e energia impossivel',
    worldBoost: 'energia cel-shaded, speed lines, explosoes de cor, ruina estilizada, neon e simbolos iconicos',
    stylePresets: ['anime-cinematic', 'manga-energy', 'abstrato-graphic', 'cinematic-reveal', 'editorial-premium'],
    hookTemplates: [
      'ISSO VIROU ANIME NA VIDA REAL',
      'O FRAME QUE TODO OTAKU REVIU',
      'NINGUEM ESPERAVA ESSE HYPE',
      'A CENA QUE PARECEU EPISODIO FINAL',
    ],
    coverTemplates: [
      'ANIME: O HYPE',
      'ANIME: O FRAME',
      'ANIME: A CENA',
      'ANIME: O CHOQUE',
    ],
    categories: ['entertainment', 'pop_culture', 'technology'],
    keywordPattern: /\b(anime|manga|mang[aá]|otaku|naruto|one piece|dragon ball|demon slayer|jujutsu|attack on titan|cosplay)\b/i,
  },
  {
    id: 'luxo_cinema',
    label: 'Luxo cinema',
    creativeAngle: 'mini filme premium com atmosfera de cinema, imagem de campanha e payoff de poster',
    vibeBoost: 'acabamento de luxo, desejo visual, elegancia agressiva e impacto de blockbuster premium',
    worldBoost: 'arquitetura premium, brilho controlado, fumaça fina, reflexos de vidro, tecido, metal e contraste escultural',
    stylePresets: ['ultrarealista', 'fashion-cinematic', 'abstrato-luxury', 'cinematic-payoff', 'editorial-premium'],
    hookTemplates: [
      'ISSO PARECE CENA DE FILME',
      'A IMAGEM MAIS ABSURDA DE HOJE',
      'NINGUEM ESPERAVA ESSE NIVEL',
      'O PAYOFF QUE VIROU POSTER',
    ],
    coverTemplates: [
      'CINEMA: O PAYOFF',
      'CINEMA: O POSTER',
      'CINEMA: O CHOQUE',
      'CINEMA: A CENA',
    ],
    categories: ['general', 'sports', 'entertainment', 'pop_culture', 'technology'],
  },
]

export function getTrendEditorialTemplateById(id: string): TrendEditorialTemplate | null {
  return TEMPLATES.find((template) => template.id === id) ?? null
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }

  return out
}

function getTemplateSeed(topic: string): number {
  return topic.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

export function pickTrendEditorialTemplate(input: {
  topic: string
  category: string
  preferredTemplateId?: string | null
}): TrendEditorialTemplate {
  const topic = input.topic.trim()
  const category = input.category.trim().toLowerCase() || 'general'

  if (input.preferredTemplateId) {
    const preferred = TEMPLATES.find((template) => template.id === input.preferredTemplateId)
    if (preferred) return preferred
  }

  const keywordMatch = TEMPLATES.find((template) => template.keywordPattern?.test(topic))
  if (keywordMatch) return keywordMatch

  // Sem keyword especifica nem preferencia aprendida: o sistema antigo usava bonus fixos
  // (luxo_cinema +1 sempre, tech_futurista +2 para technology) que dominavam a pontuacao e
  // faziam TODO topico sem keyword da mesma categoria cair sempre no mesmo template — ex.
  // qualquer topico de tecnologia sem "IA/GPT/Claude" no nome sempre virava "tech_futurista",
  // e qualquer topico de esporte/entretenimento/geral sem keyword sempre virava "luxo_cinema".
  // Agora rotaciona por seed do topico entre os templates que realmente atendem a categoria.
  const categoryMatches = TEMPLATES.filter((template) => template.categories.includes(category))
  const pool = categoryMatches.length ? categoryMatches : TEMPLATES
  return pool[getTemplateSeed(topic) % pool.length]
}

export function applyEditorialStyleRotation(
  styleRotation: string[],
  template: TrendEditorialTemplate,
): string[] {
  return uniqueStrings([...template.stylePresets, ...styleRotation])
}

export function buildEditorialHookCandidates(template: TrendEditorialTemplate, topic: string): string[] {
  const upper = topic.toUpperCase()
  return uniqueStrings(template.hookTemplates.map((value) => `${value} ${upper}`.trim()))
}

export function buildEditorialCoverCandidates(template: TrendEditorialTemplate, topic: string): string[] {
  const upper = topic.toUpperCase()
  return uniqueStrings(template.coverTemplates.map((value) => `${value} ${upper}`.trim()))
}
