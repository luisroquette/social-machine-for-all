/**
 * TESTE DE REGRESSÃO — Source 3 keyword search + nome da env var twitterapi.io
 *
 * Bug 1 — Source 3 (corrigido em f07bfc1):
 * O Source 3 usava `has:links -is:retweet lang:en` com keywords em PT-BR,
 * garantindo zero resultados (has:links não encontra vídeos; lang:en filtra
 * conteúdo em português). Resultado: prepared=0 por dias sem sinal de alerta.
 * Fix: `has:videos -is:retweet` (sem lang:en) e remoção do filtro hasExternalLink.
 *
 * Bug 2 — Nome errado da env var (corrigido neste commit):
 * Código lia `TWITTER_API_IO_KEY` mas Vercel tem `TWITTERAPI_IO_KEY`.
 * Resultado: twitterapi.io nunca era chamado → fallback para API oficial do Twitter
 * → 402 CreditsDepleted (créditos da API oficial esgotados) → zero tweets X há 3 dias,
 * mesmo com 1.1M créditos no dashboard do twitterapi.io.
 * Fix: ler `TWITTERAPI_IO_KEY` (padrão correto do projeto).
 *
 * Se qualquer um destes testes falhar, o bug foi reintroduzido.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isTopicRelevant, isCompetitorAccount, BRAND_NONEV_BLOCKLIST, BRAND_COMPETITOR_ACCOUNTS } from './index'

const __testdir = path.dirname(fileURLToPath(import.meta.url))
const CURATOR_SRC = path.resolve(__testdir, './index.ts')
const TWITTERAPI_IO_SRC = path.resolve(__testdir, '../../platforms/x/twitterapi-io.ts')

const EV_FEATURE_ENABLED = true
const EV_FEATURE_DISABLED = false

describe('REGRESSÃO: Source 3 keyword search — has:videos sem lang:en', () => {
  it('Source 3 usa has:videos (não has:links)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('has:videos')
    expect(src).not.toContain('has:links')
  })

  it('Source 3 NÃO contém lang:en (bloqueia keywords PT-BR)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Source 3 é a única seção com buscas por keyword — lang:en matava resultados PT-BR
    expect(src).not.toContain('lang:en')
  })

  it('Source 3 NÃO filtra por hasExternalLink (vídeos nativos não têm link externo)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // hasExternalLink era o filtro do has:links — sem sentido para has:videos
    const source3Block = src.slice(src.indexOf('Source 3:'), src.indexOf('Source 3:') + 500)
    expect(source3Block).not.toContain('hasExternalLink')
  })
})

describe('REGRESSÃO: Source 3 usa curator_source3_keyword_count (não hardcoded 5)', () => {
  it('Source 3 lê curator_source3_keyword_count via getNumericVariable (não slice(0, 5) fixo)', () => {
    // Bug: keywords.slice(0, 5) hardcoded usava os 5 PRIMEIROS keywords do workspace,
    // que para o Brand eram PT-BR (eletroposto, carregador EV...) com zero vídeos no X.
    // Os termos de alto volume (Tesla, electric vehicle, BYD) estavam na posição 10+.
    // Fix: ler curator_source3_keyword_count do banco, default 5. Brand configurado para 10.
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('curator_source3_keyword_count')
    // Garante que o slice usa a variável, não hardcoded 5
    const source3Block = src.slice(src.indexOf('Source 3:'), src.indexOf('Source 3:') + 800)
    expect(source3Block).toContain('keywordCount')
    expect(source3Block).not.toMatch(/slice\(0,\s*5\)/)
  })
})

describe('REGRESSÃO: nome da env var twitterapi.io — TWITTERAPI_IO_KEY', () => {
  it('twitterapi-io.ts lê TWITTERAPI_IO_KEY (não TWITTER_API_IO_KEY)', () => {
    // Bug: código lia TWITTER_API_IO_KEY mas Vercel tem TWITTERAPI_IO_KEY.
    // Resultado: twitterapi.io nunca chamado → fallback para API oficial → 402 por 3 dias.
    const src = fs.readFileSync(TWITTERAPI_IO_SRC, 'utf-8')
    expect(src).toContain('TWITTERAPI_IO_KEY')
    expect(src).not.toContain('TWITTER_API_IO_KEY')
  })

  it('curator/index.ts lê TWITTERAPI_IO_KEY (não TWITTER_API_IO_KEY)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Curator usa a key para Source 1 (radar search via twitterapi.io)
    expect(src).not.toContain('TWITTER_API_IO_KEY')
    expect(src).toContain('TWITTERAPI_IO_KEY')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: Chinese wall — brandmob não deve receber conteúdo de IA/tech
// Bug 2026-06-05: posts sobre Microsoft Copilot, NVIDIA/Marvell, Cursor Pro
// apareceram no @brand por 3 falhas encadeadas:
//   1. RADAR_QUERIES (AI-focused) rodando para o workspace brandmob
//   2. 'autopilot' em BRAND_REEL_KEYWORDS casava com "Microsoft Copilot Autopilots"
//   3. 'tesla' standalone casava com artigos financeiros NVIDIA/Marvell
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: isTopicRelevant — brandmob chinese wall (bug 2026-06-05)', () => {
  it('Microsoft Copilot Autopilot → BLOQUEADO para brandmob', () => {
    const text = 'Microsoft anuncia Copilot como super app com conceito de Autopilots — agentes autônomos que rodam continuamente. Scout é o primeiro Agent disponível.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(false)
  })

  it('Microsoft Build Copilot → BLOQUEADO para brandmob', () => {
    const text = 'Microsoft Build revela hoje o Copilot super app — unificando Copilot, Cowork, GitHub Copilot e novo Autopilot Scout Agent. Além do MAI Image 2.5 já anunciado, esperam MAI Voice 2 e MAI Transcribe 1.5.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(false)
  })

  it('NVIDIA/Marvell artigo financeiro com Tesla mencionado → BLOQUEADO para brandmob', () => {
    const text = 'Marvell dispara 32,6% após CEO da NVIDIA citar a empresa como "próxima trilionária". O setor de semicondutores reagiu em cadeia: Broadcom +4,7%, ASML +4,7%. Enquanto isso, Tesla registra +1,9% com vendas de EVs na China crescendo 39,4%.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(false)
  })

  it('Cursor Pro para universitários → BLOQUEADO para brandmob', () => {
    const text = 'Estudantes pagam $0 por ferramenta de IA que custa $240/ano. Cursor Pro libera 12 meses gratuitos para universitários — mesmo produto que empresas pagam $20/mês. Inclusos: Claude, GPT, Gemini + agent mode.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(false)
  })

  it('BYD lança EV com 1000km de autonomia → APROVADO para brandmob', () => {
    const text = 'BYD lança novo modelo EV com bateria de 1000km de autonomia no Brasil em 2026 para frotas corporativas. Eletroposto DC Fast para recarga em 15 minutos.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(true)
  })

  it('Tesla Model Y para frota corporativa → APROVADO para brandmob', () => {
    const text = 'Tesla Model Y atinge 50.000 unidades vendidas para frotas corporativas no Brasil. Recarga via supercharger em 20 minutos.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(true)
  })

  it('Eletroposto DC Fast em condomínio → APROVADO para brandmob', () => {
    const text = 'Eletroposto DC Fast instalado em condomínio residencial em BH. Brand implementa infraestrutura de recarga completa do projeto à instalação.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(true)
  })

  it('Conteúdo de IA tech é APROVADO para workspace AI&Tech (não afeta @thedoomguy_ai)', () => {
    const text = 'Microsoft Copilot Autopilot agents rodam autonomamente. Claude AI supera GPT-4 em benchmarks.'
    expect(isTopicRelevant(text, EV_FEATURE_DISABLED)).toBe(true)
  })
})

describe('REGRESSÃO: BRAND_NONEV_BLOCKLIST — lista não deve encolher', () => {
  it('blocklist tem pelo menos 15 entradas para cobertura adequada', () => {
    expect(BRAND_NONEV_BLOCKLIST.length).toBeGreaterThanOrEqual(15)
  })

  it('blocklist inclui microsoft copilot (falso positivo raiz do bug)', () => {
    expect(BRAND_NONEV_BLOCKLIST).toContain('microsoft copilot')
  })

  it('blocklist inclui autopilot agent (falso positivo via keyword autopilot)', () => {
    expect(BRAND_NONEV_BLOCKLIST).toContain('autopilot agent')
  })

  it('blocklist inclui cursor pro (Cursor AI tool, não EV)', () => {
    expect(BRAND_NONEV_BLOCKLIST).toContain('cursor pro')
  })
})

describe('REGRESSÃO: RADAR_QUERIES não roda para brandmob (bug 2026-06-05)', () => {
  it('curator/index.ts tem guard explícito que skipa Source 1 para EV_FEATURE_ENABLED', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Guard deve existir antes do bloco RADAR_QUERIES
    expect(src).toContain('features.ev_market_curation')
    // The chinese wall comment must be present as documentation
    expect(src).toContain('CHINESE WALL: RADAR_QUERIES are AI/tech focused')
  })

  it("'autopilot' standalone foi removido de BRAND_REEL_KEYWORDS", () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Garante que 'autopilot' não aparece como keyword isolada (apenas em composto 'tesla autopilot')
    // A forma simples de verificar: o array não deve ter "'autopilot'" como item isolado
    expect(src).not.toMatch(/'autopilot',/)
    expect(src).toContain("'tesla autopilot'")
  })

  it("'tesla' standalone foi removido de BRAND_REEL_KEYWORDS", () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // 'tesla' sozinho não deve aparecer no array (apenas em compostos: 'tesla model', etc.)
    expect(src).not.toMatch(/'tesla',/)
    expect(src).toContain("'tesla model'")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: Radar EV — RADAR_QUERIES_EV (ampliação 2026-06-05)
// ─────────────────────────────────────────────────────────────────────────────

const RADAR_QUERIES_SRC = path.resolve(__testdir, '../../platforms/x/radar-queries.ts')

describe('REGRESSÃO: RADAR_QUERIES_EV — EV radar para brandmob', () => {
  it('radar-queries.ts exporta RADAR_QUERIES_EV', () => {
    const src = fs.readFileSync(RADAR_QUERIES_SRC, 'utf-8')
    expect(src).toContain('RADAR_QUERIES_EV')
  })

  it('RADAR_QUERIES_EV tem pelo menos 6 queries', async () => {
    const { RADAR_QUERIES_EV } = await import('../../platforms/x/radar-queries')
    expect(RADAR_QUERIES_EV.length).toBeGreaterThanOrEqual(6)
  })

  it('nenhuma query de RADAR_QUERIES_EV menciona Claude, GPT, Anthropic ou Cursor', async () => {
    const { RADAR_QUERIES_EV } = await import('../../platforms/x/radar-queries')
    for (const rq of RADAR_QUERIES_EV) {
      const q = rq.query.toLowerCase()
      expect(q).not.toContain('claude')
      expect(q).not.toContain('gpt')
      expect(q).not.toContain('anthropic')
      expect(q).not.toContain('cursor')
    }
  })

  it('curator usa RADAR_QUERIES_EV para brandmob (não skip)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('RADAR_QUERIES_EV')
    expect(src).toContain('activeQueries')
    expect(src).not.toContain('Skipping Source 1 (RADAR_QUERIES) for Brand')
  })
})

describe('REGRESSÃO: BRAND_REEL_KEYWORDS — expansão B2B', () => {
  it("keywords incluem 'ocpp' (protocolo padrão de carregamento)", () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("'ocpp'")
  })

  it("keywords incluem 'eletroposto condomínio' (B2B Brasil)", () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("'eletroposto condomínio'")
  })

  it("keywords incluem 'smart charging' (gestão de carga)", () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("'smart charging'")
  })

  it('isTopicRelevant aprova conteúdo com eletroposto condomínio 350kW', () => {
    const text = 'Eletroposto condomínio 350kW instalado em menos de 48h. Solução B2B para frotas corporativas com recarga rápida DC.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(true)
  })

  it('isTopicRelevant aprova conteúdo com OCPP e smart charging', () => {
    const text = 'Smart charging via OCPP 2.0.1 permite gerenciar 50 pontos de recarga simultaneamente. Load balancing inteligente.'
    expect(isTopicRelevant(text, EV_FEATURE_ENABLED)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: Eficácia e assertividade — Scoring B2B, diversidade, taxonomia, RSS
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: Scoring B2B (Opt 9) — boost para termos EV niche', () => {
  it('curator/index.ts contém B2B_HIGH_VALUE array com ocpp', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('B2B_HIGH_VALUE')
    expect(src).toContain("'ocpp'")
  })

  it('curator/index.ts contém PT_BR_SIGNALS array com eletroposto', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('PT_BR_SIGNALS')
    expect(src).toContain("'eletroposto'")
  })

  it('Optimization 9 aplica fator 1.35 para termos B2B high-value', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('1.35')
  })

  it('PT-BR boost aplica fator 1.50 (upgrade de 1.25 — PT-BR first policy)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('* 1.50')
  })
})

describe('REGRESSÃO: Diversidade de fonte (curator_max_per_author)', () => {
  it('curator/index.ts usa _authorCounts para limitar por autor', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('_authorCounts')
    expect(src).toContain('curator_max_per_author')
  })

  it('default de curator_max_per_author é 2', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Default hardcoded na expressão || 2
    expect(src).toContain('|| 2')
  })
})

describe('REGRESSÃO: Taxonomia EV B2B (Problema 5)', () => {
  it('curator usa categorias EV B2B para EV_FEATURE_ENABLED', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("'ev_technical'")
    expect(src).toContain("'ev_fleet'")
    expect(src).toContain("'ev_infrastructure'")
    expect(src).toContain("'ev_regulatory'")
    expect(src).toContain("'ev_market_br'")
    expect(src).toContain("'ev_launch'")
    expect(src).toContain("'ev_news'")
  })

  it('isBreaking inclui ev_launch e ev_regulatory', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("'ev_launch'")
    expect(src).toContain("'ev_regulatory'")
    // Breaking check includes both
    const breakingLine = src.match(/isBreaking = \[([^\]]+)\]/)
    expect(breakingLine?.[1]).toContain('ev_launch')
    expect(breakingLine?.[1]).toContain('ev_regulatory')
  })
})

const RSS_SRC = path.resolve(__testdir, '../../platforms/rss/reader.ts')

describe('REGRESSÃO: RSS Source 6 — reader e integração', () => {
  it('rss/reader.ts existe e exporta fetchRssFeed e parseFeed', () => {
    const src = fs.readFileSync(RSS_SRC, 'utf-8')
    expect(src).toContain('export async function fetchRssFeed')
    expect(src).toContain('export function parseFeed')
  })

  it('parseFeed suporta RSS 2.0 (tag <item>)', () => {
    const src = fs.readFileSync(RSS_SRC, 'utf-8')
    expect(src).toContain("'item'")
  })

  it('parseFeed suporta Atom (tag <entry>)', () => {
    const src = fs.readFileSync(RSS_SRC, 'utf-8')
    expect(src).toContain("'entry'")
  })

  it('curator importa fetchRssFeed de rss/reader', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("from '@/lib/platforms/rss/reader'")
    expect(src).toContain('fetchRssFeed')
  })

  it('curator/index.ts contém Source 6 RSS block', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain("Source 6: RSS/Atom news feeds")
    expect(src).toContain(".eq('platform', 'rss')")
  })

  it('sourceCounts inclui rss (não perde contabilidade)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('rss: 0')
    expect(src).toContain('sourceCounts.rss++')
  })
})

// ── Gap 4: Dedup window 96h para brandmob ────────────────────────────────────
describe('REGRESSÃO: Gap 4 — dedup_window_hours default 48h (brandmob precisa 96h via DB)', () => {
  it('curator lê dedup_window_hours de ctx.settings (não hardcoded)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Deve ler do settings, não de um valor fixo
    expect(src).toContain('ctx.settings?.dedup_window_hours')
  })

  it('fallback padrão do curator é 48 (valor original preservado)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // O fallback para workspaces sem override deve continuar sendo 48
    expect(src).toMatch(/dedup_window_hours[^)]*\?\?[^)]*48/)
  })

  it('dedup_window_hours aceita override via settings (ex: 96 para brandmob)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // A linha de dedup deve usar Number() para tratar strings vindas do JSON do settings
    expect(src).toMatch(/Number\(ctx\.settings\?\.dedup_window_hours/)
  })
})

// ── Gap 1: Writer calibração por categoria EV B2B ────────────────────────────
const WRITER_SRC = path.resolve(__testdir, '../writer/index.ts')

describe('REGRESSÃO: Gap 1 — writer calibração EV B2B taxonomy', () => {
  it('writer/index.ts exporta ou define evCategoryFocus()', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    expect(src).toContain('evCategoryFocus')
  })

  it('evCategoryFocus cobre todas as 7 categorias EV B2B', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    for (const cat of ['ev_technical', 'ev_fleet', 'ev_infrastructure', 'ev_regulatory', 'ev_market_br', 'ev_launch', 'ev_news']) {
      expect(src).toContain(cat)
    }
  })

  it('userMessage injeta CATEGORIA DETECTADA para brandmob quando presente', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    expect(src).toContain('CATEGORIA DETECTADA')
    expect(src).toContain('score_breakdown?.category')
  })

  it('CATEGORIA DETECTADA é condicionada à flag de curadoria EV', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    const brandMobBlock = src.indexOf('features.ev_market_curation && item.score_breakdown?.category')
    expect(brandMobBlock).toBeGreaterThan(-1)
  })

  it('system prompt brandmob documenta as categorias EV B2B', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    expect(src).toContain('CALIBRAÇÃO POR CATEGORIA')
    expect(src).toContain('ev_technical')
    expect(src).toContain('ev_fleet')
  })
})

// ── PT-BR First — brandmob curadoria com peso máximo Brasil ──────────────────
const RADAR_SRC = path.resolve(__testdir, '../../platforms/x/radar-queries.ts')

describe('REGRESSÃO: PT-BR First — radar queries e scoring', () => {
  it('RADAR_QUERIES_EV tem ≥8 queries (2 novas PT-BR adicionadas)', () => {
    const src = fs.readFileSync(RADAR_SRC, 'utf-8')
    // Conta os blocos id: dentro do RADAR_QUERIES_EV (após o marcador do array)
    const evBlock = src.slice(src.indexOf('RADAR_QUERIES_EV'))
    const idMatches = evBlock.match(/\bid:/g) ?? []
    expect(idMatches.length).toBeGreaterThanOrEqual(8)
  })

  it('≥3 queries de RADAR_QUERIES_EV contêm lang:pt', () => {
    const src = fs.readFileSync(RADAR_SRC, 'utf-8')
    const matches = src.match(/lang:pt/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('ev-brasil-pt usa min_faves:10 (não 20 — conteúdo BR tem menos engajamento)', () => {
    const src = fs.readFileSync(RADAR_SRC, 'utf-8')
    // Garante que o threshold foi baixado para 10 no bloco RADAR_QUERIES_EV
    // Nota: RADAR_QUERIES (AI&Tech) tem lang:pt min_faves:20 para brasil-launches — não alterar
    expect(src).toContain('lang:pt min_faves:10')
    // O bloco RADAR_QUERIES_EV não deve ter min_faves:20 em queries com lang:pt
    const evBlock = src.slice(src.indexOf('RADAR_QUERIES_EV'))
    expect(evBlock).not.toContain('lang:pt min_faves:20')
  })

  it('RADAR_QUERIES_EV inclui ev-brasil-b2b (condomínio/frota PT)', () => {
    const src = fs.readFileSync(RADAR_SRC, 'utf-8')
    expect(src).toContain('ev-brasil-b2b')
    expect(src).toContain('eletroposto condomínio')
  })

  it('RADAR_QUERIES_EV inclui ev-brasil-marcas (contas BR)', () => {
    const src = fs.readFileSync(RADAR_SRC, 'utf-8')
    expect(src).toContain('ev-brasil-marcas')
    expect(src).toContain('BYDAutoBrasil')
  })

  it('PT_BR_SIGNALS boost usa fator 1.50 (não 1.25)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('* 1.50')
    expect(src).not.toContain('* 1.25')
  })

  it('PT_BR_SIGNALS contém sinais de marcas brasileiras', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('byd brasil')
    expect(src).toContain('são paulo')
  })

  it('Source 3 aplica lang:pt para keywords com acentos (brandmob)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('hasPtAccent')
    expect(src).toContain('lang:pt')
    expect(src).toContain('langFilter')
  })

  it('Source 3 só aplica lang:pt para brandmob (não vaza para AI&Tech)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // langFilter deve ser condicionado ao EV_FEATURE_ENABLED
    expect(src).toContain('features.ev_market_curation && hasPtAccent')
  })
})

describe('REGRESSÃO: PT-BR First — writer mandato de idioma', () => {
  it('writer/index.ts contém mandato IDIOMA OBRIGATÓRIO PT-BR para brandmob', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    expect(src).toContain('IDIOMA OBRIGATÓRIO')
    expect(src).toContain('Português Brasileiro')
  })

  it('evCategoryFocus(ev_fleet) inclui instrução PT-BR', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    // ev_fleet deve ter "PT-BR" na sua instrução
    const fleetLine = src.match(/ev_fleet.*/)
    expect(fleetLine?.[0]).toContain('PT-BR')
  })

  it('evCategoryFocus(ev_technical) inclui instrução PT-BR', () => {
    const src = fs.readFileSync(WRITER_SRC, 'utf-8')
    const techLine = src.match(/ev_technical.*/)
    expect(techLine?.[0]).toContain('PT-BR')
  })
})

// ── curator_disable_keyword_search — proteção contra reativar silenciosamente ─
describe('REGRESSÃO: curator_disable_keyword_search — Source 3 não pode ser silenciado', () => {
  it('curator lê curator_disable_keyword_search via getVariable()', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // A leitura deve usar getVariable com o nome exato da chave
    expect(src).toContain("getVariable(ctx.workspaceId, 'curator_disable_keyword_search')")
  })

  it('Source 3 só é pulado quando disableKeywordSearch === true (comparação === string)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // Deve comparar com a string 'true', não com boolean — valores do DB são strings
    expect(src).toContain("=== 'true'")
  })

  it('Source 3 roda quando disableKeywordSearch é false (guard usa !disableKeywordSearch)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // O guard deve ser !disableKeywordSearch — se alguém mudar para disableKeywordSearch,
    // a lógica inverte e Source 3 fica permanentemente desabilitado
    expect(src).toContain('!disableKeywordSearch')
  })

  it('Source 3 busca tweets quando guard passa (searchTweets chamado dentro do bloco)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    // searchTweets deve estar dentro do bloco protegido por !disableKeywordSearch
    const source3Block = src.slice(
      src.indexOf("Source 3: Keyword Search"),
      src.indexOf("Source 4:")
    )
    expect(source3Block).toContain('searchTweets')
    expect(source3Block).toContain('!disableKeywordSearch')
  })
})

describe('REGRESSÃO: Competitor account blocklist — Jun/2026 (ChargeUp incident)', () => {
  // Bug: pipeline curou vídeo publicitário da "Charge Up" (concorrente) e postou
  // como conteúdo da Brand. O post estava visível com logo, URL e telefone da empresa concorrente.
  // Fix: BRAND_COMPETITOR_ACCOUNTS blocklist + isCompetitorAccount() nos 3 sources.

  it('ChargeUpEnergy é bloqueado para Brand', () => {
    expect(isCompetitorAccount('ChargeUpEnergy', EV_FEATURE_ENABLED)).toBe(true)
    expect(isCompetitorAccount('chargeupenergymy', EV_FEATURE_ENABLED)).toBe(true)
  })

  it('ChargePoint é bloqueado para Brand', () => {
    expect(isCompetitorAccount('ChargePoint', EV_FEATURE_ENABLED)).toBe(true)
    expect(isCompetitorAccount('chargepoint_eu', EV_FEATURE_ENABLED)).toBe(true)
  })

  it('EVgo é bloqueado para Brand', () => {
    expect(isCompetitorAccount('EVgo', EV_FEATURE_ENABLED)).toBe(true)
    expect(isCompetitorAccount('evgonetwork', EV_FEATURE_ENABLED)).toBe(true)
  })

  it('WallboxEV e WallboxLatam são bloqueados para Brand', () => {
    expect(isCompetitorAccount('WallboxEV', EV_FEATURE_ENABLED)).toBe(true)
    expect(isCompetitorAccount('WallboxLatam', EV_FEATURE_ENABLED)).toBe(true)
  })

  it('Tesla, BYDCompany, Rivian NÃO são bloqueados (fabricantes, não operadoras)', () => {
    expect(isCompetitorAccount('Tesla', EV_FEATURE_ENABLED)).toBe(false)
    expect(isCompetitorAccount('BYDCompany', EV_FEATURE_ENABLED)).toBe(false)
    expect(isCompetitorAccount('Rivian', EV_FEATURE_ENABLED)).toBe(false)
  })

  it('Nenhuma conta é bloqueada para workspace AI&Tech', () => {
    expect(isCompetitorAccount('ChargePoint', EV_FEATURE_DISABLED)).toBe(false)
    expect(isCompetitorAccount('EVgo', EV_FEATURE_DISABLED)).toBe(false)
  })

  it('ev-breaking-brands não contém operadoras concorrentes', () => {
    const radarSrc = fs.readFileSync(
      path.resolve(__testdir, '../../platforms/x/radar-queries.ts'),
      'utf-8'
    )
    // Check that the radar queries file doesn't include competitor charging operators
    // in from: clauses (ChargePoint, EVgo, WallboxEV, Electrify_America removed Jun/2026)
    expect(radarSrc).not.toContain('from:ChargePoint')
    expect(radarSrc).not.toContain('from:EVgo')
    expect(radarSrc).not.toContain('from:WallboxEV')
    expect(radarSrc).not.toContain('from:Electrify_America')
  })

  it('ev-brasil-marcas não contém operadoras concorrentes', () => {
    const radarSrc = fs.readFileSync(
      path.resolve(__testdir, '../../platforms/x/radar-queries.ts'),
      'utf-8'
    )
    expect(radarSrc).not.toContain('from:ChargersBrasil')
    expect(radarSrc).not.toContain('from:WallboxLatam')
  })

  it('isCompetitorAccount é aplicado em Source 1 (radar), Source 2 (profile) e Source 3 (keyword)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    const occurrences = (src.match(/isCompetitorAccount/g) || []).length
    // Declaração da função + 3 usos nos sources = mínimo 4 ocorrências
    expect(occurrences).toBeGreaterThanOrEqual(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: brazil_scoped — priorização de conteúdo brasileiro (bug 2026-07-06)
// Reel publicado sobre Telangana (Índia) — 5 das 8 RADAR_QUERIES_EV não tinham
// nenhum filtro de Brasil/idioma, e nada depois disso despriorizava o resultado.
// Fix: tag brazilScoped na query → carregado no tweet → gravado em
// score_breakdown.brazil_scoped, consumido por sortBrazilFirst() no
// reels-prepare-brand para tentar conteúdo BR antes do global.
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: brazil_scoped tagging (bug Telangana 2026-07-06)', () => {
  it('exatamente as 3 queries BR-scoped de RADAR_QUERIES_EV têm brazilScoped:true', () => {
    const radarSrc = fs.readFileSync(
      path.resolve(__testdir, '../../platforms/x/radar-queries.ts'),
      'utf-8',
    )
    const occurrences = (radarSrc.match(/brazilScoped:\s*true/g) || []).length
    expect(occurrences).toBe(3)
    // As 3 queries que devem ter o flag (lang:pt ou contas brasileiras)
    for (const id of ['ev-brasil-pt', 'ev-brasil-b2b', 'ev-brasil-marcas']) {
      const idx = radarSrc.indexOf(`id: '${id}'`)
      expect(idx).toBeGreaterThan(-1)
      const block = radarSrc.slice(idx, radarSrc.indexOf('},', idx))
      expect(block).toContain('brazilScoped: true')
    }
  })

  it('as 5 queries globais de RADAR_QUERIES_EV NÃO têm brazilScoped:true', () => {
    const radarSrc = fs.readFileSync(
      path.resolve(__testdir, '../../platforms/x/radar-queries.ts'),
      'utf-8',
    )
    for (const id of ['ev-breaking-brands', 'ev-fleet-corporate', 'ev-charging-infra', 'ev-bess-solar', 'ev-b2b-property']) {
      const idx = radarSrc.indexOf(`id: '${id}'`)
      expect(idx).toBeGreaterThan(-1)
      const block = radarSrc.slice(idx, radarSrc.indexOf('},', idx))
      expect(block).not.toContain('brazilScoped: true')
    }
  })

  it('curator carrega rq.brazilScoped no tweet nos dois caminhos (TwitterAPI.io e X API fallback)', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    const occurrences = (src.match(/brazilScoped:\s*rq\.brazilScoped/g) || []).length
    // 1x no push do TwitterAPI.io + 1x no push do fallback X API = mínimo 2
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('curator grava brazil_scoped em score_breakdown no insert de curated_content', () => {
    const src = fs.readFileSync(CURATOR_SRC, 'utf-8')
    expect(src).toContain('brazil_scoped: tweet.brazilScoped')
  })
})
