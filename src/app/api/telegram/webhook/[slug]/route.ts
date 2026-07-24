export const maxDuration = 300

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isTelegramWebhook } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { parseCommand, executeCommand } from '@/lib/telegram/commands'
import { sendMessage } from '@/lib/telegram/bot-manager'
import { sendTypingAction } from '@/lib/telegram/message-sender'
import { registry } from '@/lib/agents/agent-registry'
import type { AgentSlug, RunContext } from '@/lib/agents/agent-types'
import { processPhoto, processVoice, processDocument, type ProcessedMedia } from '@/lib/telegram/media-processor'
import { buildBrandContext } from '@/lib/brand/build-brand-context'
import { buildFeedbackGuardrails } from '@/lib/eval/feedback-loop'
import { loadMemories, formatMemoryContext } from '@/lib/memory/agent-memory'

interface RouteParams {
  params: Promise<{ slug: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  if (!isTelegramWebhook(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug: rawSlug } = await params

  // Load registry and validate slug — only respond for known agents
  await registry.loadAll()
  if (!registry.has(rawSlug as AgentSlug)) return NextResponse.json({ ok: true })
  const slug = rawSlug as AgentSlug

  const update = await request.json()
  const msg = update.message
  if (!msg) return NextResponse.json({ ok: true })
  if (msg.from?.is_bot) return NextResponse.json({ ok: true })

  const hasContent = msg.text || msg.caption || msg.photo || msg.voice || msg.audio || msg.document
  if (!hasContent) return NextResponse.json({ ok: true })

  const text = msg.text ?? msg.caption ?? ''
  const { chat, from } = msg
  const supabase = getAdminClient()

  // DEDUP
  const { data: upserted } = await supabase
    .from('telegram_message_queue')
    .upsert({
      chat_id: chat.id,
      message_id: msg.message_id,
      from_user: from ?? {},
      text,
      status: 'processing',
    }, { onConflict: 'chat_id,message_id', ignoreDuplicates: true })
    .select('id')
    .single()

  if (!upserted) return NextResponse.json({ ok: true })

  // Load bot config — try the requested slug first, fall back to editor-in-chief if no token
  const { data: slugRow } = await supabase
    .from('agents')
    .select('id, workspace_id, telegram_bot_token, telegram_bot_username')
    .eq('slug', slug)
    .single()

  let agentRow = slugRow?.telegram_bot_token ? slugRow : null

  if (!agentRow) {
    const { data: fallbackRow } = await supabase
      .from('agents')
      .select('id, workspace_id, telegram_bot_token, telegram_bot_username')
      .eq('slug', 'editor-in-chief')
      .single()
    agentRow = fallbackRow ?? null
  }

  if (!agentRow?.telegram_bot_token) return NextResponse.json({ ok: true })

  const botToken = agentRow.telegram_bot_token as string
  const botUsername = (agentRow.telegram_bot_username as string | null)?.replace(/^@/, '').toLowerCase() ?? ''
  const workspaceId = agentRow.workspace_id as string

  // Slash commands (fast, synchronous)
  const parsed = parseCommand(text)
  if (parsed) {
    await executeCommand({
      command: parsed.command, args: parsed.args, chatId: chat.id,
      fromUserId: from?.id ?? 0, fromUsername: from?.username,
      agentSlug: slug, botToken,
    })
    await supabase.from('telegram_message_queue').update({ status: 'done', processed_at: new Date().toISOString() }).eq('id', upserted.id)
    return NextResponse.json({ ok: true })
  }

  const chatType = chat.type
  const isGroupChat = chatType === 'group' || chatType === 'supergroup'

  // In group chats, respond when ANY workspace bot is mentioned (handles shared bot tokens).
  // Load all bot usernames to catch e.g. @sm_strategist_v2_bot when endpoint is editor-in-chief.
  let mentionsBot = botUsername ? text.toLowerCase().includes(`@${botUsername}`) : false
  if (isGroupChat && !mentionsBot) {
    const { data: allAgents } = await supabase
      .from('agents')
      .select('telegram_bot_username')
      .eq('workspace_id', workspaceId)
      .not('telegram_bot_username', 'is', null)
    const allUsernames = (allAgents ?? [])
      .map(a => (a.telegram_bot_username as string)?.replace(/^@/, '').toLowerCase())
      .filter(Boolean)
    mentionsBot = allUsernames.some(u => text.toLowerCase().includes(`@${u}`))
  }

  const isReplyToBot = Boolean(
    botUsername &&
    msg.reply_to_message?.from?.username &&
    msg.reply_to_message.from.username.toLowerCase() === botUsername
  )

  // In group chats: editor-in-chief responds to all messages (it's the head agent).
  // Other agents only answer when explicitly @mentioned or replied-to.
  const isEditorInChief = slug === 'editor-in-chief'
  if (isGroupChat && !isEditorInChief && !mentionsBot && !isReplyToBot) {
    await supabase
      .from('telegram_message_queue')
      .update({ status: 'done', processed_at: new Date().toISOString() })
      .eq('id', upserted.id)

    return NextResponse.json({ ok: true, skipped: 'group_message_not_addressed' })
  }

  // ── HEAVY PROCESSING: use waitUntil to keep function alive after returning 200 ──
  waitUntil((async () => {
    // Media
    let media: ProcessedMedia | null = null
    try {
      if (msg.photo) media = await processPhoto(botToken, msg.photo)
      else if (msg.voice || msg.audio) media = await processVoice(botToken, (msg.voice ?? msg.audio).file_id, (msg.voice ?? msg.audio).duration)
      else if (msg.document) media = await processDocument(botToken, msg.document)
    } catch (err) { console.error('[webhook] Media:', err instanceof Error ? err.message : err) }

    // Typing
    const typingInterval = setInterval(() => { sendTypingAction(botToken, chat.id).catch(() => {}) }, 4000)
    sendTypingAction(botToken, chat.id).catch(() => {})

    // Context — load brand, feedback and memory in parallel (same as agent-runner)
    const [brandContext, feedbackContext, memories] = await Promise.all([
      buildBrandContext(workspaceId).catch(() => ''),
      buildFeedbackGuardrails(workspaceId, slug).catch(() => ''),
      loadMemories(workspaceId, slug).catch(() => ({ individual: [], shared: [] })),
    ])

    const runCtx: RunContext = {
      workspaceId, agentId: agentRow.id as string,
      brandContext,
      feedbackContext,
      memoryContext: formatMemoryContext(memories),
      telegramChatId: chat.id, telegramBotToken: botToken, dryRun: false,
    }

    // History
    const { data: historyRows } = await supabase
      .from('telegram_conversations')
      .select('role, content').eq('chat_id', chat.id)
      .in('role', ['user', 'assistant'])
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true }).limit(10)

    const history = (historyRows || []).map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }))

    await supabase.from('telegram_conversations').insert({
      chat_id: chat.id, role: 'user', content: media ? `${text}\n[${media.description}]` : text,
    })

    try {
      type ChatCapable = { handleChat: (text: string, ctx: RunContext, history: Array<{ role: 'user' | 'assistant'; content: string }>, media?: ProcessedMedia | null) => Promise<{ response: string; tokensUsed: number }> }
      const rawAgent = registry.get(slug) ?? registry.get('editor-in-chief')!
      const chatAgent = (typeof (rawAgent as unknown as ChatCapable).handleChat === 'function'
        ? rawAgent
        : registry.get('editor-in-chief')!) as unknown as ChatCapable
      const result = await chatAgent.handleChat(text, runCtx, history, media)
      clearInterval(typingInterval)

      // Extract H1 title once for reuse across exports
      const lowerMsg = text.toLowerCase()
      const h1Match = result.response.match(/^#\s+(.+)/m)
      const contentTitle = h1Match ? h1Match[1].trim().slice(0, 60) : null
      const dateStr = new Date().toISOString().split('T')[0]

      // Auto Markdown file — large structured reports (> 3000 chars with H1) or explicit request
      const isLargeReport = result.response.length > 3000 && /^#\s/m.test(result.response)
      const wantsMarkdown = lowerMsg.includes('markdown') || lowerMsg.includes('.md')
      if (isLargeReport || wantsMarkdown) {
        try {
          const { sendTelegramDocument } = await import('@/lib/export/send-document')
          const mdBuf = Buffer.from(result.response, 'utf-8')
          const mdFilename = contentTitle
            ? `${contentTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dateStr}.md`
            : `relatorio-${dateStr}.md`
          const sent = await sendTelegramDocument(botToken, chat.id, mdBuf, mdFilename, '📄 Relatório completo em Markdown')
          if (!sent) await sendMessage(botToken, chat.id, result.response.slice(0, 4000))
        } catch {
          await sendMessage(botToken, chat.id, result.response.slice(0, 4000))
        }
      } else {
        await sendMessage(botToken, chat.id, result.response)
      }

      // Auto PDF
      if (lowerMsg.includes('pdf')) {
        try {
          const { generateReportPDF } = await import('@/lib/export/report-pdf')
          const { sendTelegramDocument } = await import('@/lib/export/send-document')
          const buf = await generateReportPDF({ title: contentTitle ?? 'Relatorio Social Machine', content: result.response })
          const sent = await sendTelegramDocument(botToken, chat.id, buf, `relatorio-${dateStr}.pdf`, '📄 Relatorio em PDF')
          if (!sent) await sendMessage(botToken, chat.id, '⚠️ Falha ao enviar PDF')
        } catch (e) {
          await sendMessage(botToken, chat.id, `⚠️ Erro PDF: ${e instanceof Error ? e.message.slice(0, 80) : 'desconhecido'}`)
        }
      }

      // Auto email
      if (lowerMsg.includes('email')) {
        try {
          const notificationEmail = process.env.NOTIFICATION_EMAIL
          if (!notificationEmail) {
            await sendMessage(botToken, chat.id, '⚠️ NOTIFICATION_EMAIL não configurado')
            return NextResponse.json({ ok: true })
          }
          const { sendReportEmail } = await import('@/lib/export/report-email')
          const subject = contentTitle
            ? `[SM] ${contentTitle}`
            : `[SM] Relatorio ${new Date().toLocaleDateString('pt-BR')}`
          const { data: ws } = await supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle() as { data: { name: string } | null }
          await sendReportEmail({
            to: notificationEmail,
            subject,
            content: result.response,
            label: { system: 'Social Machine V3.1', scope: ws?.name || workspaceId },
          })
          await sendMessage(botToken, chat.id, '📧 Email enviado')
        } catch (e) { console.error('[webhook] Email:', e instanceof Error ? e.message : e) }
      }

      // Auto CSV
      if (lowerMsg.includes('csv')) {
        try {
          const { generateCSV, extractTableFromMarkdown } = await import('@/lib/export/report-csv')
          const { sendTelegramDocument } = await import('@/lib/export/send-document')
          const tables = extractTableFromMarkdown(result.response)
          if (!tables.length) {
            await sendMessage(botToken, chat.id, '⚠️ Sem tabela encontrada na resposta para gerar CSV')
          } else {
            const buf = generateCSV(tables)
            const filename = `relatorio-${dateStr}.csv`
            const sent = await sendTelegramDocument(botToken, chat.id, buf, filename, '📊 Relatório em CSV')
            if (!sent) await sendMessage(botToken, chat.id, '⚠️ Falha ao enviar CSV')
          }
        } catch (e) {
          await sendMessage(botToken, chat.id, `⚠️ Erro CSV: ${e instanceof Error ? e.message.slice(0, 80) : 'desconhecido'}`)
        }
      }

      // Auto Google Sheets
      if (lowerMsg.includes('planilha') || lowerMsg.includes('sheets')) {
        try {
          const { createGoogleSheet, markdownTablesToSheetData } = await import('@/lib/export/report-sheets')
          const sheets = markdownTablesToSheetData(result.response)
          if (!sheets.length) {
            await sendMessage(botToken, chat.id, '⚠️ Sem tabelas encontradas para criar planilha')
          } else {
            const res = await createGoogleSheet({
              title: `Social Machine ${new Date().toLocaleDateString('pt-BR')}`,
              sheets,
            })
            if (res.ok && res.url) {
              await sendMessage(botToken, chat.id, `📋 Planilha criada: ${res.url}`)
            } else {
              await sendMessage(botToken, chat.id, `⚠️ Erro ao criar planilha: ${res.error ?? 'desconhecido'}`)
            }
          }
        } catch (e) {
          await sendMessage(botToken, chat.id, `⚠️ Erro Sheets: ${e instanceof Error ? e.message.slice(0, 80) : 'desconhecido'}`)
        }
      }

      await supabase.from('telegram_conversations').insert({ chat_id: chat.id, role: 'assistant', content: result.response })
    } catch (err) {
      clearInterval(typingInterval)
      console.error('[webhook] Error:', err instanceof Error ? err.message : err)
      await sendMessage(botToken, chat.id, '⚠️ Erro ao processar. Tente novamente.')
    }

    await supabase.from('telegram_message_queue').update({ status: 'done', processed_at: new Date().toISOString() }).eq('id', upserted.id)

    // Cleanup: remove conversation history older than 24h to prevent unbounded growth
    await supabase.from('telegram_conversations')
      .delete()
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  })())

  // Return 200 IMMEDIATELY — Telegram won't retry
  return NextResponse.json({ ok: true })
}
