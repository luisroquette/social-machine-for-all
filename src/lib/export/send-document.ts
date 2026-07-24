/**
 * Send a document (file) via Telegram Bot API.
 */

export async function sendTelegramDocument(
  botToken: string,
  chatId: number,
  file: Buffer,
  filename: string,
  caption?: string
): Promise<boolean> {
  const formData = new FormData()
  formData.append('chat_id', String(chatId))
  formData.append('document', new Blob([new Uint8Array(file)]), filename)
  if (caption) formData.append('caption', caption.slice(0, 1024))

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[send-document] Failed: ${err.slice(0, 200)}`)
    return false
  }

  return true
}
