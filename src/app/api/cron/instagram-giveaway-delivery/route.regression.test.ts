import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/instagram-giveaway-delivery/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: instagram-giveaway-delivery wiring', () => {
  it('envia DM via /me/messages com PAGE access token na query string', () => {
    expect(SRC).toMatch(/URLSearchParams\(\{\s*access_token:\s*params\.accessToken\s*\}\)/)
    expect(SRC).toMatch(/fetch\(`\$\{GRAPH_API\}\/me\/messages\?\$\{query\.toString\(\)\}`/)
    expect(SRC).not.toMatch(/body:\s*JSON\.stringify\(\{[\s\S]*access_token:\s*params\.accessToken/)
  })

  it('manda recipient e message serializados em form-urlencoded', () => {
    expect(SRC).toMatch(/Content-Type': 'application\/x-www-form-urlencoded'/)
    expect(SRC).toMatch(/recipient:\s*JSON\.stringify\(\{\s*id:\s*params\.recipientId\s*\}\)/)
    expect(SRC).toMatch(/message:\s*JSON\.stringify\(\{\s*text:\s*params\.text\s*\}\)/)
  })

  it('marca o lead como failed quando a entrega da DM falha', () => {
    expect(SRC).toMatch(/from\('instagram_giveaway_leads'\)/)
    expect(SRC).toMatch(/status:\s*'failed'/)
    expect(SRC).toMatch(/last_error:\s*message/)
  })

  it('marca conversão explícita quando a DM do giveaway é entregue', () => {
    expect(SRC).toMatch(/converted_at:\s*new Date\(\)\.toISOString\(\)/)
    expect(SRC).toMatch(/conversion_event:\s*'dm_delivery'/)
  })
})
