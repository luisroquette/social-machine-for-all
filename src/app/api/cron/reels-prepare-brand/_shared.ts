/**
 * Shared utilities for Brand reel preparation pipeline.
 * Used by:
 *   - reels-prepare-brand      (X/Twitter source — fast, 240s budget)
 *   - reels-prepare-brand-youtube (YouTube source — yt-dlp, 270s budget)
 */

// EV/automotive keywords that qualify content as reel material for Brand.
// REMOVED from prior version (false positives):
//   'tesla'          → standalone matches financial/Elon Musk/NVIDIA articles
//   'infrastructure' → too broad
//   'fleet'          → too broad ('fleet of servers'); use 'fleet electrif' below
//   'autonomia'      → too broad in PT-BR
//   'battery'        → too broad; use 'battery storage' / 'bateria' (EV context)
// ADDED (false negatives — PT-BR content was failing before Jun/2026 fix):
//   'carro elétrico'   → most common PT-BR term for EV
//   'veículo elétrico' → formal/journalistic PT-BR term
//   'carregadores?'    → 'carregador'/'carregadores' (EV charger in PT-BR).
//     NOTE: 'carregad' was the prior pattern but the trailing \b in the group prevented it
//     from matching any real word (e.g. 'carregad\bor' fails because 'd' is followed by 'o').
//     Fix: full word 'carregadores?' with correct boundary.
export const EV_KEYWORDS = /\b(electric.?vehicles?|electric.?propulsion|ev\b|bev\b|phev\b|carregador(?:es)?|eletroposto|charging.?stations?|charging.?infra|ev.?infra|byd|rivian|lucid|nio|polestar|zeekr|xpeng|li.?auto|hyundai.?ioniq|kia.?ev|vw.?id|renault.?zoe|battery.?storage|energy.?storage|bateria|range.?anxiety|fast.?charge|carga.?rapida|v2g|vehicle.?to.?grid|mobilidade.?eletrica|frota.?eletrica|fleet.?electrif|zero.?emission|decarboni|carro.{1,3}el[eé]tricos?|ve[íi]culos?.{1,3}el[eé]tricos?)\b/i

// Tesla requires EV-specific context — prevents contamination from financial/semiconductor articles
export const TESLA_EV_CONTEXT = /tesla.{0,40}(model [3syx]\b|electric|supercharger|energy|powerwall|megapack|semi\b|cybertruck|gigafactory|battery|fsd|autopilot)|model [3syx]\b.{0,40}tesla/i

export function brandImageFallback(sourceContent: string): string {
  const c = sourceContent.toLowerCase()
  if (/tesla|rivian|byd|lucid|polestar|zeekr|nio|hyundai|kia/.test(c))
    return 'Electric vehicle low angle hero shot looking up, dark studio, violet and electric blue rim lighting, anamorphic lens flare, subject fills upper 65%'
  if (/charging|eletroposto|charger|fast.?charge|carga|v2g/.test(c))
    return 'Modern DC fast charger wide angle ground level, electric blue underglow, wet reflective asphalt, subject upper half'
  if (/fleet|frota|corporate|empresa|logistics|infrastructure|infraestrutura/.test(c))
    return "Electric vehicle fleet bird's eye drone shot, dusk, violet sky, geometric rows, upper portion"
  return 'Electric highway low angle cinematic, EVs with blue headlights, violet sky, motion blur, upper two-thirds'
}

export function buildDallePrompt(imagePrompt: string, sourceContent: string): string {
  const c = sourceContent.toLowerCase()
  let camera: string
  if (/tesla|rivian|byd|lucid|polestar|zeekr|nio|hyundai|kia/.test(c))
    camera = 'low angle shot looking up at vehicle, dramatic rim lighting'
  else if (/charging|eletroposto|charger|fast.?charge|carga|v2g/.test(c))
    camera = 'wide angle ground level, electric blue underglow on wet asphalt'
  else if (/fleet|frota|corporate|empresa|logistics|infrastructure|infraestrutura/.test(c))
    camera = 'aerial drone view, organized geometric composition'
  else
    camera = 'low angle cinematic wide shot'
  return `${imagePrompt}, ${camera}, vertical 9:16, dark moody atmosphere, deep blacks, electric blue and violet neon accents, cinematic, photorealistic, no text, no watermarks`
}

/**
 * Reordena candidatos priorizando conteúdo Brasil-scoped (score_breakdown.brazil_scoped=true)
 * antes do global — mantém a ordem relativa dentro de cada grupo (partição estável).
 * Conteúdo global só é tentado como fallback, quando o BR se esgota. (bug Telangana 2026-07-06)
 */
export function sortBrazilFirst<T extends { score_breakdown?: unknown }>(items: T[]): T[] {
  const brazil: T[] = []
  const global: T[] = []
  for (const item of items) {
    // score_breakdown vem como Json do client tipado — narrow em runtime
    const sb = item.score_breakdown as { brazil_scoped?: boolean } | null | undefined
    if (sb?.brazil_scoped === true) brazil.push(item)
    else global.push(item)
  }
  return [...brazil, ...global]
}

export function parseSrtToFrames(srt: string, fps: number): Array<{ text: string; startFrame: number; endFrame: number }> {
  if (!srt.trim()) return []
  const entries: Array<{ text: string; startFrame: number; endFrame: number }> = []
  for (const block of srt.trim().split(/\n\n+/)) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const m = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/)
    if (!m) continue
    const g = m.slice(1).map(Number)
    const s = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
    const e = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
    const text = lines.slice(2).join(' ').trim()
    if (text) entries.push({ text, startFrame: Math.round(s * fps), endFrame: Math.round(e * fps) })
  }
  return entries
}

export function buildbrandAiPrompt({
  srtText,
  instagramHandle,
  sourceContent,
  fullText,
  comentaCTACount = 0,
}: {
  srtText: string
  instagramHandle: string
  sourceContent: string
  fullText: string
  comentaCTACount?: number
}): string {
  const today = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' })
  return `DATA ATUAL: ${today}.

TAREFA 1: ${srtText ? `TRADUZIR SRT para PT-BR (manter timestamps):\n${srtText}` : 'Sem SRT.'}

TAREFA 2: hookTitle — MÁXIMO 5 PALAVRAS EM MAIÚSCULAS, impacto visual de capa.
NÃO é título de notícia. É a frase que para o scroll.
Exemplos fortes:
- "FROTA 100% ELÉTRICA AGORA"
- "ELETROPOSTO EM 72 HORAS"
- "ZERO CUSTO DE RECARGA"
- "1.5M EVs ATÉ 2030"
- "CARREGA EM 10 MINUTOS"
highlightWords: 2-3 palavras de alto impacto do hookTitle
subtitle: 30-40 chars — o QUE A brand MOB RESOLVE neste contexto (ex: "infraestrutura EV corporativa", "eletroposto para condomínios")
kpi: OBRIGATÓRIO se o conteúdo contiver qualquer número relevante. Métrica impactante curta (ex: "40% menos custo", "350kW em 10min", "R$ 2.5B mercado 2026"). Omitir apenas se não há número relevante.

REGRA OBRIGATÓRIA DE AUTOINTELIGIBILIDADE: alguém que veja só a capa (hookTitle + subtitle + kpi), sem ouvir o áudio nem ler a legenda completa, DEVE entender do que o conteúdo trata. Se o conteúdo original (CONTEÚDO ORIGINAL / TRANSCRIÇÃO abaixo) for sobre um mercado, país, empresa ou caso específico que NÃO seja o Brasil, o hookTitle OU o subtitle DEVE deixar isso explícito (ex: "ÍNDIA: 6.000 ELETROPOSTOS ATÉ 2030" em vez de só "6.000 ELETROPOSTOS ATÉ 2030"). Nunca omita o país/origem quando o dado não for do mercado brasileiro — isso confunde o público, que pode ler o número como sendo do Brasil.

TAREFA 3: caption Instagram — OBJETIVO: GERAR LEADS para brand.com.br

A Brand oferece soluções completas de infraestrutura EV: venda de eletropostos, instalação e consultoria para empresas.
Escolha o enquadramento mais relevante para este conteúdo:
  • FROTA: gestores de frota corporativa querendo eletrificar veículos
  • IMÓVEL: incorporadoras, condomínios, shoppings que precisam de infra de recarga
  • ENERGIA: postos de combustível e varejistas diversificando para EV
  • GOVERNO: prefeituras e órgãos públicos em mobilidade elétrica sustentável

ESTRUTURA NARRATIVA RECOMENDADA — B2B, sem clickbait:
1. COLD OPEN: primeira linha com número, gargalo ou contraste executivo.
2. PROBLEMA DE NEGÓCIO: deixe claro o custo/risco/oportunidade para frota, imóvel, varejo ou governo.
3. PROVA/CONTEXTO: use dado, caso, país, empresa ou tendência do conteúdo original.
4. CONSEQUÊNCIA: traduza para receita, valorização, conveniência, operação ou redução de risco.
5. TAKEAWAY: uma frase sóbria que um decisor lembraria.
Use essa estrutura como trilho invisível. Não escreva labels como "Cold open" ou "Takeaway".

REGRAS OBRIGATÓRIAS:
- PRIMEIRA LINHA (máx 100 chars): gancho de máximo impacto — aparece antes do "ver mais" no feed
- Comprimento variável: às vezes 2 parágrafos compactos (~130 palavras), às vezes 3-4 com mais contexto (~200 palavras). Nunca mesma estrutura em posts consecutivos.
- CTA de conversão obrigatório com "👉 brand.com.br". Pode aparecer no penúltimo parágrafo em vez do último.
  Exemplos de CTA:
  • "Sua empresa ainda não tem infraestrutura de recarga? A Brand resolve do projeto à instalação. 👉 brand.com.br"
  • "Gestor de frota? Calculamos o ROI da eletrificação para você. 👉 brand.com.br"
  • "Quer eletroposto no seu condomínio ou posto? A Brand implementa. 👉 brand.com.br"
- Mencione ${instagramHandle} uma vez
- Sem bullet points. Parágrafos fluidos. Mínimo 130 palavras.
- 8-12 hashtags: misturar #eletroposto #EVBrasil #mobilidadeeletrica com hashtags do segmento (#frota #gestaofrota | #construcao #incorporadora | #postosdecombustivel | #prefeitura #mobilidadesustentavel)
- Tom: autoridade técnica, orientado a resultado — não clickbait, não "salva esse post"
${comentaCTACount >= 2 ? '- PROIBIDO usar "comenta X" como CTA neste post — limite de 2x/semana atingido. Use outro CTA (visitar site, fazer pergunta, reflexão).' : `- CTA "comenta X" permitido se relevante (${comentaCTACount}/2 usos nos últimos 7 dias).`}

TAREFA 4: imagePrompt — fundo cinematográfico 9:16 específico para este conteúdo.

ESTÉTICA brand MOB: fundo escuro (#070609), iluminação violeta/azul elétrico, tech-forward premium B2B. NÃO consumer-flashy.

REGRA DE COMPOSIÇÃO OBRIGATÓRIA: o sujeito principal (veículo, eletroposto, etc.) deve ocupar os 55% SUPERIORES do frame. Os 45% INFERIORES devem ser escuros/sombreados — serão cobertos pelo overlay de texto. NUNCA centralize o sujeito verticalmente.

Exemplos por categoria:
- Lançamento de veículo: "[MARCA] electric SUV low angle hero shot looking up, dark studio, violet and electric blue rim lighting, anamorphic lens flare, subject fills upper 65% of frame, no people"
- Eletroposto/infraestrutura: "Modern 350kW DC fast charger wide angle ground level shot, electric blue underglow on wet asphalt, electric arcs visible, subject anchored upper half, dark lower portion, no people"
- Dados/frota: "Electric vehicle fleet bird's eye drone shot, dusk, violet-tinted sky, geometric rows, subject occupies upper portion, dark tarmac lower half, no people"
- Política/regulação: "Electric highway low angle cinematic, EVs with blue headlights, violet-blue gradient sky upper two-thirds, dark asphalt lower third, motion blur, no people"

Saída: inglês, 150-350 chars, NO BRAND LOGOS, NO TEXT IN IMAGE, NO WATERMARKS, NO PEOPLE.

CONTEÚDO ORIGINAL: ${sourceContent}
TRANSCRIÇÃO: ${fullText.slice(0, 400)}

ATENÇÃO: Retorne SOMENTE o JSON abaixo, sem texto antes ou depois, sem markdown, sem explicações:
{"srt_ptbr":"...", "hookTitle":"...", "highlightWords":["..."], "subtitle":"...", "kpi":"...", "imagePrompt":"...", "caption":"..."}`
}
