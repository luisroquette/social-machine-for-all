/**
 * Send formatted HTML email reports via Resend.
 * Env: RESEND_API_KEY
 * From: noreply@lfrprojects.com.br
 */

import { Resend } from 'resend'

let resendClient: Resend | null = null

function getResend(): Resend {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY nao configurada')
    resendClient = new Resend(key)
  }
  return resendClient
}

/**
 * Convert markdown-like report content to styled HTML email.
 */
function markdownToHtml(content: string): string {
  const lines = content.split('\n')
  const html: string[] = []
  let inTable = false

  html.push(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a; line-height: 1.6;">
  `)

  for (const line of lines) {
    const trimmed = line.trim()
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|')

    // Close table when leaving table block
    if (inTable && !isTableRow) {
      html.push('</tbody></table>')
      inTable = false
    }

    if (!trimmed) {
      html.push('<br/>')
      continue
    }

    // H1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      html.push(`<h1 style="font-size: 22px; color: #000; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; margin-top: 24px;">${clean(trimmed.slice(2))}</h1>`)
      continue
    }

    // H2
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      html.push(`<h2 style="font-size: 18px; color: #111; margin-top: 20px;">${clean(trimmed.slice(3))}</h2>`)
      continue
    }

    // H3
    if (trimmed.startsWith('### ')) {
      html.push(`<h3 style="font-size: 15px; color: #333; margin-top: 16px;">${clean(trimmed.slice(4))}</h3>`)
      continue
    }

    // Bullet
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      html.push(`<div style="padding-left: 16px; margin: 4px 0;">• ${clean(trimmed.slice(2))}</div>`)
      continue
    }

    // Numbered
    if (/^\d+\.\s/.test(trimmed)) {
      html.push(`<div style="padding-left: 16px; margin: 4px 0;">${clean(trimmed)}</div>`)
      continue
    }

    // Table row
    if (isTableRow) {
      const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())
      if (cells.some(c => /^[-:]+$/.test(c))) continue // separator row

      if (!inTable) {
        // First row = header
        html.push(`<table style="border-collapse: collapse; width: 100%; margin: 16px 0;"><thead><tr>`)
        html.push(cells.map(c => `<th style="background: #f5f5f5; font-weight: 600; padding: 8px 12px; border: 1px solid #e5e7eb; text-align: left;">${clean(c)}</th>`).join(''))
        html.push(`</tr></thead><tbody>`)
        inTable = true
      } else {
        html.push(`<tr>`)
        html.push(cells.map(c => `<td style="padding: 8px 12px; border: 1px solid #e5e7eb; vertical-align: top;">${clean(c)}</td>`).join(''))
        html.push(`</tr>`)
      }
      continue
    }

    // Regular text
    html.push(`<p style="margin: 6px 0;">${clean(trimmed)}</p>`)
  }

  // Close table if content ends inside one
  if (inTable) html.push('</tbody></table>')

  html.push('</div>')

  return html.join('\n')
}

function clean(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 13px;">$1</code>')
}

/**
 * Identifica de qual sistema/workspace um e-mail de relatório fala. Obrigatório
 * em todo envio — ver REGRESSÃO §multi-projeto 2026-07-06: o remetente
 * noreply@lfrprojects.com.br é compartilhado com o Social Machine V2.1 e
 * outros projetos, e nenhum e-mail deixava claro qual sistema/workspace
 * estava alertando.
 */
export interface ReportEmailLabel {
  /** Ex: "Social Machine V3.1" */
  system: string
  /** Nome do workspace, ex: "AI & Tech", "Brand", ou "AI & Tech + Brand" quando o relatório cobre mais de um */
  scope: string
}

/**
 * Send a report email via Resend.
 */
export async function sendReportEmail(options: {
  to: string | string[]
  subject: string
  content: string
  label: ReportEmailLabel
  pdfAttachment?: { filename: string; buffer: Buffer }
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const resend = getResend()
  const recipients = Array.isArray(options.to) ? options.to : [options.to]
  const taggedSubject = `[${options.label.system} · ${options.label.scope}] ${options.subject}`

  const htmlBody = `
    <p style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">${options.label.system} · ${options.label.scope}</p>
    ${markdownToHtml(options.content)}
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0 16px;"/>
    <p style="font-size: 11px; color: #999; text-align: center;">
      Gerado automaticamente por ${options.label.system} — Editor-Chefe (${options.label.scope})<br/>
      ${new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' })}
    </p>
  `

  const payload: Parameters<typeof resend.emails.send>[0] = {
    from: 'Social Machine <noreply@lfrprojects.com.br>',
    to: recipients,
    subject: taggedSubject,
    html: htmlBody,
  }

  if (options.pdfAttachment) {
    payload.attachments = [{
      filename: options.pdfAttachment.filename,
      content: options.pdfAttachment.buffer,
    }]
  }

  const MAX_ATTEMPTS = 3
  let lastError = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const sendPromise = resend.emails.send(payload)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Resend API timeout after 15s')), 15_000)
      )
      const { data, error } = await Promise.race([sendPromise, timeoutPromise])
      if (error) {
        lastError = error.message
        // Non-transient errors (auth, validation) — don't retry
        if (error.statusCode && error.statusCode < 500) {
          return { ok: false, error: lastError }
        }
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, attempt * 1000))
          continue
        }
        return { ok: false, error: lastError }
      }
      return { ok: true, id: data?.id }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, attempt * 1000))
        continue
      }
    }
  }

  return { ok: false, error: lastError }
}
