import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/instagram-comments/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: instagram-comments giveaway reply audit', () => {
  it('atualiza o lead com reply auditável e pedido de follow', () => {
    expect(SRC).toMatch(/status:\s*'comment_replied'/)
    expect(SRC).toMatch(/commentReplyText:\s*reply/)
    expect(SRC).toMatch(/followRequestedAt:\s*repliedAt/)
  })
})

describe('REGRESSÃO: Cláusula Pétrea #9 — reply de comentário usa generateTextWithFallback', () => {
  // A geração de resposta usava generateSimpleText (generateText direto + fallback
  // OpenRouter inline), sem retry exponencial nem sentinel tipado — divergência da
  // Cláusula #9 (crons SEMPRE via generateTextWithFallback). Fix: 24/07/2026.
  it('importa e usa generateTextWithFallback (retry + fallback DeepSeek→Gemini)', () => {
    expect(SRC).toContain("from '@/lib/ai/generate-with-fallback'")
    expect(SRC).toMatch(/generateTextWithFallback\(/)
  })

  it('não volta pro wrapper sem retry/sentinel tipado (generateSimpleText)', () => {
    expect(SRC).not.toMatch(/generateSimpleText/)
  })

  it('não faz fetch cru a nenhum provider de IA (só Graph API do Instagram)', () => {
    expect(SRC).not.toMatch(/api\.(deepseek|openai|anthropic)\.com|generativelanguage\.googleapis/)
  })
})

describe('REGRESSÃO: CTA (follow+DM) só dispara com giveaway ativo — não em risada/emoji', () => {
  // isKeywordCta é só contagem de palavras (≤2). Num post viral SEM giveaway, "😂😂😂"/"kkkk"
  // caía no prompt de CTA e pedia DM pra um link inexistente (spam off-brand + risco anti-ban).
  // Fix 24/07/2026: prompt de CTA passa a ser gated por giveaway; sem giveaway = resposta normal.
  it('define isGiveawayCta = keywordCta && giveaway', () => {
    expect(SRC).toMatch(/isGiveawayCta\s*=\s*keywordCta\s*&&\s*!!\s*giveawayContext/)
  })

  it('o prompt de CTA é gated por isGiveawayCta, não por keywordCta cru', () => {
    expect(SRC).toMatch(/const userMessage = isGiveawayCta/)
    expect(SRC).not.toMatch(/const userMessage = keywordCta\b/)
  })
})

describe('REGRESSÃO: media-mute durável — posts marcados nunca recebem auto-reply', () => {
  // Post viral (ex: reel de humor) que estoura a fila de comentários pode ser mutado por
  // media_id via workspace_settings.autoreply_muted_media_ids (CSV). O cron faz bulk-skip
  // do pending desses media a cada run — fecha backlog + inflow sem whack-a-mole. 24/07/2026.
  it('lê a lista de media mutados de autoreply_muted_media_ids', () => {
    expect(SRC).toMatch(/autoreply_muted_media_ids/)
  })

  it('faz bulk-skip de pending em media mutado (skip_reason media_muted)', () => {
    expect(SRC).toMatch(/skip_reason:\s*'media_muted'/)
    expect(SRC).toMatch(/\.in\('media_id',\s*mutedMediaIds\)/)
  })
})

describe('REGRESSÃO: cap diário de respostas é configurável por workspace (não hardcoded)', () => {
  // Um pico viral no @brand (23/07/2026) estourou o cap fixo de 80/dia e represou
  // ~2.900 comentários. Cap virou config por workspace (comment_daily_reply_cap);
  // ausência da chave herda o default legado de 80 (Regra do Gate — nunca desabilita
  // comportamento anterior em silêncio).
  it('resolve o cap via workspace_settings (getNumericVariable), não constante fixa', () => {
    expect(SRC).toMatch(/comment_daily_reply_cap/)
    expect(SRC).toMatch(/getNumericVariable/)
  })
})
