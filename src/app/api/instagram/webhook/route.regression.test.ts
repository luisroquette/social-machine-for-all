import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/instagram/webhook/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: instagram webhook giveaway prelead', () => {
  it('pré-cria lead de giveaway para comentário keyword CTA já no webhook', () => {
    expect(SRC).toMatch(/isKeywordCta\(c\.text\)/)
    expect(SRC).toMatch(/findTrendGiveawayForMedia\(supabase, c\.media_id\)/)
    expect(SRC).toMatch(/upsertGiveawayLead\(\{/)
    expect(SRC).toMatch(/status:\s*'commented'/)
  })
})
