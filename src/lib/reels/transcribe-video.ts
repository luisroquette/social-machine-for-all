export interface TranscriptResult {
  srtText: string
  fullText: string
}

/**
 * Transcreve um vídeo via Railway /transcribe COM timeout.
 *
 * Por que existe (bug 16/06/2026 — stall de produção desde 14/06):
 * No reels-prepare a chamada /transcribe não tinha AbortSignal. Quando o Whisper
 * do Railway travava ou demorava demais, o fetch bloqueava até o Vercel matar a
 * função inteira (maxDuration=300s) — ANTES de gravar qualquer reel_ready e antes
 * de marcar o item. Como a função morria, o mesmo item (vídeo mais novo, processado
 * primeiro) era reprocessado a cada run: stall permanente.
 *
 * Esta função NUNCA lança: em timeout/erro/resposta não-ok, retorna o texto de
 * fallback sem SRT — o reel é produzido mesmo assim (o render já tolera ausência
 * de legendas). Assim, um transcribe lento nunca derruba o cron.
 */
export async function transcribeVideo(
  rendererUrl: string,
  apiKey: string,
  videoUrl: string,
  fallbackText: string,
  timeoutMs = 60_000,
): Promise<TranscriptResult> {
  try {
    const res = await fetch(`${rendererUrl}/transcribe`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ video_url: videoUrl }),
    })

    if (!res.ok) return { srtText: '', fullText: fallbackText }

    const tr = JSON.parse(await res.text()) as { srt?: string; text?: string }
    const text = tr.text ?? ''

    // Ignora trilhas só com música/intro/outro — não é fala real para legendar.
    const hasRealSpeech =
      text.length > 30 &&
      !/^[♪🎶🎵\s]+$/.test(text) &&
      !/música/i.test(text) &&
      !/music|encerramento|intro|outro/i.test(text)

    if (hasRealSpeech) return { srtText: tr.srt ?? '', fullText: text }
    return { srtText: '', fullText: fallbackText }
  } catch {
    // timeout (AbortError), rede ou JSON inválido → segue sem SRT, sem matar o cron
    return { srtText: '', fullText: fallbackText }
  }
}
