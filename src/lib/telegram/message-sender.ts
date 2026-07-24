import { sendMessage } from './bot-manager'

const MAX_MESSAGE_LENGTH = 4096

/**
 * Split text into chunks that fit Telegram's 4096 char limit.
 * Splits at newlines when possible, otherwise at spaces.
 */
export function splitText(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Try to split at newline
    let splitIdx = remaining.lastIndexOf('\n', maxLength)
    if (splitIdx < maxLength * 0.3) {
      // Newline too early, try space
      splitIdx = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitIdx < maxLength * 0.3) {
      // No good split point, force split
      splitIdx = maxLength
    }

    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }

  return chunks
}

/**
 * Send a long message, splitting if necessary.
 */
export async function sendLongMessage(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  const chunks = splitText(text)
  for (const chunk of chunks) {
    await sendMessage(token, chatId, chunk)
  }
}

/**
 * Edit an existing message.
 */
export async function editMessage(
  token: string,
  chatId: number,
  messageId: number,
  text: string
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${token}/editMessageText`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, MAX_MESSAGE_LENGTH),
      parse_mode: 'Markdown',
    }),
  })
  const data = await res.json()
  if (!data.ok) {
    // Retry without Markdown
    const res2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, MAX_MESSAGE_LENGTH),
      }),
    })
    const data2 = await res2.json()
    return data2.ok
  }
  return true
}

/**
 * Delete a message.
 */
export async function deleteMessage(
  token: string,
  chatId: number,
  messageId: number
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${token}/deleteMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  })
  const data = await res.json()
  return data.ok
}

/**
 * Send a "typing" action indicator.
 */
export async function sendTypingAction(
  token: string,
  chatId: number
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action: 'typing',
    }),
  })
}
