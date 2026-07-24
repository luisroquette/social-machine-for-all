/**
 * REGRESSÃO: Cross-workspace credential isolation
 *
 * Cobre o bug crítico de 19/04–17/05/2026 onde 94 posts do @thedoomguy_ai
 * foram publicados no @brand porque getInstagramCredentials() caia para
 * as env vars (INSTAGRAM_USER_ID/INSTAGRAM_ACCESS_TOKEN do Brand) quando
 * o workspace AI & Tech não tinha credenciais no banco.
 *
 * Garantias:
 * 1. Workspace sem credenciais no DB retorna strings vazias (não env vars)
 * 2. Workspace com credenciais no DB retorna exatamente o que está no DB
 * 3. checkCredentialHealth detecta plataformas ativas sem credenciais
 * 4. LinkedIn segue a mesma regra de isolamento
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock do Supabase ──────────────────────────────────────────────────────────

const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFrom }),
}))

// ── Env vars controladas ──────────────────────────────────────────────────────

const brandMOB_ENV_USER_ID = 'brandMOB_ENV_USER_17841471659935614'
const brandMOB_ENV_TOKEN = 'EAAcjX_ENV_brandMOB_TOKEN'

beforeEach(() => {
  vi.resetModules()
  process.env.INSTAGRAM_USER_ID = brandMOB_ENV_USER_ID
  process.env.INSTAGRAM_ACCESS_TOKEN = brandMOB_ENV_TOKEN
  process.env.INSTAGRAM_APP_ID = 'ENV_APP_ID'
  process.env.LINKEDIN_ACCESS_TOKEN = 'ENV_LINKEDIN_TOKEN'
  mockSingle.mockReset()
  mockFrom.mockClear()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadModule() {
  const mod = await import('./load-credentials')
  return mod
}

function mockWorkspaceCredentials(creds: Record<string, unknown>) {
  mockSingle.mockResolvedValue({ data: { platform_credentials: creds }, error: null })
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: cross-workspace credential isolation — Instagram', () => {
  it('workspace sem credenciais no DB retorna igUserId e accessToken VAZIOS — nunca env vars', async () => {
    mockWorkspaceCredentials({}) // AI & Tech: platform_credentials = {}

    const { getInstagramCredentials } = await loadModule()
    const creds = await getInstagramCredentials('00000000-0000-0000-0000-000000000000')

    // Este era o bug: antes retornava brandMOB_ENV_USER_ID
    expect(creds.igUserId).toBe('')
    expect(creds.accessToken).toBe('')

    // appId pode vir do env (é app-level, não conta-específico)
    expect(creds.appId).toBe('ENV_APP_ID')
  })

  it('workspace com credenciais no DB usa EXCLUSIVAMENTE os valores do DB', async () => {
    const DB_USER_ID = 'DB_brandMOB_17841471659935614'
    const DB_TOKEN = 'DB_EAAcjX_brandMOB_TOKEN'

    mockWorkspaceCredentials({
      instagram: { appId: 'DB_APP_ID', userId: DB_USER_ID, accessToken: DB_TOKEN },
    })

    const { getInstagramCredentials } = await loadModule()
    const creds = await getInstagramCredentials('00000000-0000-0000-0000-000000000000')

    expect(creds.igUserId).toBe(DB_USER_ID)
    expect(creds.accessToken).toBe(DB_TOKEN)
    expect(creds.appId).toBe('DB_APP_ID')

    // Confirma que NÃO usou env vars do Brand
    expect(creds.igUserId).not.toBe(brandMOB_ENV_USER_ID)
    expect(creds.accessToken).not.toBe(brandMOB_ENV_TOKEN)
  })

  it('dois workspaces distintos retornam credenciais isoladas entre si', async () => {
    const { getInstagramCredentials } = await loadModule()

    // Brand: tem credenciais
    mockSingle.mockResolvedValueOnce({
      data: { platform_credentials: { instagram: { userId: 'brandMOB_ID', accessToken: 'brandMOB_TOKEN' } } },
      error: null,
    })
    const brandCreds = await getInstagramCredentials('11111111-1111-4111-8111-111111111111')

    // AI & Tech: sem credenciais
    mockSingle.mockResolvedValueOnce({
      data: { platform_credentials: {} },
      error: null,
    })
    const aiTechCreds = await getInstagramCredentials('22222222-2222-4222-8222-222222222222')

    expect(brandCreds.igUserId).toBe('brandMOB_ID')
    expect(aiTechCreds.igUserId).toBe('') // nunca pode ser 'brandMOB_ID'
    expect(aiTechCreds.accessToken).toBe('') // nunca pode ser token do Brand
  })
})

describe('REGRESSÃO: prefere token EAA permanente sobre IGAA que expira', () => {
  /**
   * Bug de 15/06/2026: o @thedoomguy_ai tinha um token IGAA (graph.instagram.com,
   * ~60 dias) no campo `accessToken` e o token EAA permanente (nunca expira) parado
   * em `pageAccessToken`. getInstagramCredentials devolvia o IGAA → ao expirar,
   * reels e stories pararam silenciosamente. O fix passa a preferir o EAA +
   * igBusinessId quando presentes.
   */
  it('quando há pageAccessToken (EAA) + igBusinessId, usa-os em vez do accessToken IGAA', async () => {
    mockWorkspaceCredentials({
      instagram: {
        appId: '2009216909636123',
        userId: '33097294459918652', // IG User ID (fluxo IGAA)
        accessToken: 'IGAAMmLoqDIiF_TOKEN_QUE_EXPIRA',
        igBusinessId: '17841477880013573', // Instagram Business Account ID
        pageAccessToken: 'EAAcjX0Qs8hs_TOKEN_QUE_NAO_EXPIRA',
      },
    })

    const { getInstagramCredentials } = await loadModule()
    const creds = await getInstagramCredentials('00000000-0000-0000-0000-000000000000')

    // Deve usar o token permanente e o Business Account ID (host graph.facebook.com)
    expect(creds.accessToken).toBe('EAAcjX0Qs8hs_TOKEN_QUE_NAO_EXPIRA')
    expect(creds.igUserId).toBe('17841477880013573')

    // NUNCA o token IGAA que expira nem o IG User ID do fluxo Instagram
    expect(creds.accessToken).not.toContain('IGAA')
    expect(creds.igUserId).not.toBe('33097294459918652')
  })

  it('fallback: sem pageAccessToken, usa accessToken+userId (padrão Brand com EAA)', async () => {
    mockWorkspaceCredentials({
      instagram: {
        userId: '17841471659935614', // já é o Business Account ID
        accessToken: 'EAAc_TOKEN_brandMOB',
      },
    })

    const { getInstagramCredentials } = await loadModule()
    const creds = await getInstagramCredentials('00000000-0000-0000-0000-000000000000')

    expect(creds.accessToken).toBe('EAAc_TOKEN_brandMOB')
    expect(creds.igUserId).toBe('17841471659935614')
  })

  it('não usa pageAccessToken sozinho sem igBusinessId (par incompleto → fallback)', async () => {
    mockWorkspaceCredentials({
      instagram: {
        userId: '33097294459918652',
        accessToken: 'IGAA_TOKEN',
        pageAccessToken: 'EAA_SEM_BUSINESS_ID',
        // igBusinessId ausente
      },
    })

    const { getInstagramCredentials } = await loadModule()
    const creds = await getInstagramCredentials('00000000-0000-0000-0000-000000000000')

    // Par incompleto não deve ser usado — cai no fallback accessToken/userId
    expect(creds.accessToken).toBe('IGAA_TOKEN')
    expect(creds.igUserId).toBe('33097294459918652')
  })
})

describe('REGRESSÃO: cross-workspace credential isolation — LinkedIn', () => {
  it('workspace sem credenciais no DB retorna accessToken VAZIO — nunca env var', async () => {
    mockWorkspaceCredentials({})

    const { getLinkedInCredentials } = await loadModule()
    const creds = await getLinkedInCredentials('00000000-0000-0000-0000-000000000000')

    expect(creds.accessToken).toBe('')
    expect(creds.personUrn).toBeUndefined()
  })
})

describe('REGRESSÃO: checkCredentialHealth detecta configuração incorreta', () => {
  it('retorna problemas quando instagram está ativo mas sem credenciais no DB', async () => {
    mockWorkspaceCredentials({}) // sem instagram no DB

    const { checkCredentialHealth } = await loadModule()
    const issues = await checkCredentialHealth('00000000-0000-0000-0000-000000000000', ['instagram', 'x'])

    expect(issues).toHaveLength(1)
    expect(issues[0].platform).toBe('instagram')
    expect(issues[0].missing).toContain('userId')
    expect(issues[0].missing).toContain('accessToken')
  })

  it('retorna sem problemas quando credenciais estão configuradas corretamente', async () => {
    mockWorkspaceCredentials({
      instagram: { userId: '17841471659935614', accessToken: 'EAAcjX_TOKEN' },
    })

    const { checkCredentialHealth } = await loadModule()
    const issues = await checkCredentialHealth('00000000-0000-0000-0000-000000000000', ['instagram'])

    expect(issues).toHaveLength(0)
  })

  it('x e youtube não são checados (usam auth própria, não conta-específica)', async () => {
    mockWorkspaceCredentials({}) // sem x nem youtube no DB

    const { checkCredentialHealth } = await loadModule()
    const issues = await checkCredentialHealth('00000000-0000-0000-0000-000000000000', ['x', 'youtube'])

    expect(issues).toHaveLength(0)
  })
})
