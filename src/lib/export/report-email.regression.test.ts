/**
 * REGRESSÃO: e-mails de relatório não identificavam sistema/workspace — bug 2026-07-06
 *
 * Contexto: o remetente noreply@lfrprojects.com.br é compartilhado com o
 * Social Machine V2.1 e outros projetos. O usuário recebeu um alerta
 * "🔴 Social Machine — 1 alerta(s) crítico(s)" (heartbeat/route.ts, workspace
 * AI & Tech) misturado com alertas do V2.1 e não tinha como saber, olhando o
 * assunto ou o corpo, que sistema/workspace era.
 *
 * Fix: sendReportEmail() agora exige um ReportEmailLabel {system, scope} —
 * usado para prefixar o assunto e identificar o sistema/workspace no corpo
 * e no rodapé do e-mail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email-123' }, error: null })

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

describe('REGRESSÃO: sendReportEmail identifica sistema + workspace no assunto e no corpo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockResolvedValue({ data: { id: 'email-123' }, error: null })
    process.env.RESEND_API_KEY = 'test-key'
  })

  it('prefixa o assunto com [Sistema · Scope]', async () => {
    const { sendReportEmail } = await import('@/lib/export/report-email')
    await sendReportEmail({
      to: 'test@example.com',
      subject: '🔴 Social Machine — 1 alerta(s) crítico(s)',
      content: 'corpo do alerta',
      label: { system: 'Social Machine V3.1', scope: 'AI & Tech' },
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('[Social Machine V3.1 · AI & Tech] 🔴 Social Machine — 1 alerta(s) crítico(s)')
  })

  it('inclui sistema + scope no corpo e no rodapé do HTML', async () => {
    const { sendReportEmail } = await import('@/lib/export/report-email')
    await sendReportEmail({
      to: 'test@example.com',
      subject: 'assunto',
      content: 'corpo',
      label: { system: 'Social Machine V3.1', scope: 'Brand' },
    })

    const payload = sendMock.mock.calls[0][0]
    expect(payload.html).toContain('Social Machine V3.1 · Brand')
    expect(payload.html).toContain('Editor-Chefe (Brand)')
  })

  it('digest multi-workspace usa o scope combinado dos handles afetados', async () => {
    const { sendReportEmail } = await import('@/lib/export/report-email')
    await sendReportEmail({
      to: 'test@example.com',
      subject: 'Instagram sem postagens',
      content: 'corpo',
      label: { system: 'Social Machine V3.1', scope: '@thedoomguy_ai + @brand' },
    })

    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toContain('@thedoomguy_ai + @brand')
  })
})
