// Brand safety Brand — a empresa VENDE eletromobilidade B2B.
//
// Conteúdo que associa veículo elétrico a perigo (incêndio, explosão, acidente,
// recall, morte) afasta exatamente o público que compra: gestores de frota,
// síndicos e empresas avaliando eletrificação. Origem: Reel "11 EVS EM CHAMAS"
// (BYDs incendiados na BR-101) publicado em 07/07/2026 e reprovado pelo usuário.
// Nem reenquadramento positivo salva — o lead lê a manchete, não a ressalva.
//
// Usado em DUAS camadas: curadoria (isTopicRelevant, entrada) e reviewer
// (rejeição de draft, saída). Match por substring lowercase, mesmo idioma do
// BRAND_NONEV_BLOCKLIST do curador. Falso positivo = pular uma notícia;
// falso negativo = dano de marca. Fail-closed por design.
//
// Regression tests: brand-brand-safety.regression.test.ts — NÃO remover termos
// sem rodar os testes.

export const BRAND_NEGATIVE_EV_BLOCKLIST = [
  // ── Fogo / explosão (PT) ────────────────────────────────────────────────
  'em chamas', 'pega fogo', 'pegou fogo', 'pegam fogo', 'pegaram fogo', 'pegando fogo',
  'fogo em', 'fogo no', 'fogo na',
  'incêndi', 'incendi',            // incêndio, incendiado, incendiou...
  'explosão', 'explosao', 'explodiu', 'explodiram', 'explode',
  'destruíd', 'destruid',          // destruído(s)/destruída(s), com e sem acento
  // ── Acidente / segurança (PT) ───────────────────────────────────────────
  'recall',
  'acidente', 'colisão', 'colisao', 'capotou', 'capotamento', 'atropel',
  'morreu', 'morreram', 'mortos', 'mortas', 'fatal',
  // ── Fire / explosion (EN) ───────────────────────────────────────────────
  'catches fire', 'caught fire', 'catch fire', 'on fire',
  'burst into flames', 'bursts into flames', 'in flames', 'up in flames',
  'battery fire', 'fire risk', 'burned down', 'burns down', 'ablaze',
  'explosion', 'explodes', 'exploded',
  // ── Crash / safety (EN) ─────────────────────────────────────────────────
  'crash', 'collision', 'fatality', 'fatalities', 'killed', 'death toll', 'deadly',
]

/**
 * True se o texto enquadra EVs/eletromobilidade de forma negativa (perigo,
 * desastre, recall). Conteúdo flagrado NUNCA deve ser curado nem aprovado
 * para o workspace Brand — descartar (skip), não reescrever.
 */
export function hasNegativeEvFraming(text: string): boolean {
  const lower = text.toLowerCase()
  return BRAND_NEGATIVE_EV_BLOCKLIST.some(kw => lower.includes(kw))
}
