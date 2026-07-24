import { getAdminClient } from '@/lib/supabase/admin'

interface BotClient {
  token: string
  username: string
  agentSlug: string
}

class BotManager {
  private bots: Map<string, BotClient> = new Map()
  private groupChatId: number | null = null
  private loaded = false

  async loadFromDatabase(workspaceId: string): Promise<void> {
    if (this.loaded) return

    const supabase = getAdminClient()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('telegram_group_id')
      .eq('id', workspaceId)
      .single()

    if (workspace?.telegram_group_id) {
      this.groupChatId = Number(workspace.telegram_group_id)
    }

    const { data: agents } = await supabase
      .from('agents')
      .select('slug, telegram_bot_token, telegram_bot_username')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .not('telegram_bot_token', 'is', null)

    if (agents) {
      for (const agent of agents) {
        if (agent.telegram_bot_token) {
          this.bots.set(agent.slug, {
            token: agent.telegram_bot_token,
            username: agent.telegram_bot_username ?? agent.slug,
            agentSlug: agent.slug,
          })
        }
      }
    }

    console.log(`[bot-manager] Loaded ${this.bots.size} bots for workspace ${workspaceId}`)
    this.loaded = true
  }

  getBot(agentSlug: string): BotClient | undefined {
    return this.bots.get(agentSlug)
  }

  getGroupChatId(): number | null {
    return this.groupChatId
  }

  listBots(): BotClient[] {
    return [...this.bots.values()]
  }

  async sendAsAgent(agentSlug: string, text: string, chatId?: number): Promise<void> {
    const bot = this.bots.get(agentSlug)
    if (!bot) {
      console.warn(`[bot-manager] Bot not found for agent '${agentSlug}'`)
      return
    }

    const targetChatId = chatId ?? this.groupChatId
    if (!targetChatId) {
      console.warn(`[bot-manager] No chat ID available for sending`)
      return
    }

    await sendMessage(bot.token, targetChatId, text)
  }

  async setupWebhooks(baseUrl: string): Promise<{ slug: string; ok: boolean; error?: string }[]> {
    const results: { slug: string; ok: boolean; error?: string }[] = []
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET

    // Build token→slug map: editor-in-chief takes priority over other agents sharing the same token.
    // This ensures the group chat webhook always points to the head agent.
    const tokenToSlug = new Map<string, string>()
    for (const [slug, bot] of this.bots) {
      const existing = tokenToSlug.get(bot.token)
      if (!existing || slug === 'editor-in-chief') {
        tokenToSlug.set(bot.token, slug)
      }
    }

    const seenTokens = new Set<string>()

    for (const [slug, bot] of this.bots) {
      // Skip if this token is already registered (or will be registered) under a higher-priority slug
      if (seenTokens.has(bot.token)) {
        const winner = tokenToSlug.get(bot.token)
        results.push({ slug, ok: false, error: `skipped: token registered under '${winner}'` })
        continue
      }

      // If this token belongs to a higher-priority slug, defer until that slug's turn
      if (tokenToSlug.get(bot.token) !== slug) {
        results.push({ slug, ok: false, error: `skipped: token registered under '${tokenToSlug.get(bot.token)}'` })
        continue
      }

      seenTokens.add(bot.token)

      const webhookUrl = `${baseUrl}/api/telegram/webhook/${slug}`
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${bot.token}/setWebhook`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: webhookUrl,
              secret_token: webhookSecret,
              allowed_updates: ['message', 'callback_query'],
            }),
          }
        )
        const data = await res.json()
        results.push({ slug, ok: data.ok, error: data.ok ? undefined : data.description })
      } catch (err) {
        results.push({ slug, ok: false, error: String(err) })
      }

      // Telegram rate-limits setWebhook to 1 req/sec per token
      await new Promise(r => setTimeout(r, 1100))
    }

    return results
  }

  reset(): void {
    this.bots.clear()
    this.groupChatId = null
    this.loaded = false
  }
}

async function sendMessage(token: string, chatId: number, text: string, parseMode = 'Markdown'): Promise<{ ok: boolean; messageId?: number }> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  })
  const data = await res.json()
  if (!data.ok) {
    // Fallback: retry without parse_mode if Markdown fails
    if (parseMode === 'Markdown') {
      return sendMessage(token, chatId, text, '')
    }
    console.error(`[telegram] sendMessage failed:`, data.description)
  }
  return { ok: data.ok, messageId: data.result?.message_id }
}

export const botManager = new BotManager()
export { sendMessage }
