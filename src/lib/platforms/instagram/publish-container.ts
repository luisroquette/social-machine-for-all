/**
 * Publica um container do Instagram (REELS/VIDEO) que já atingiu status FINISHED.
 *
 * Por que existe (bug 16/06/2026):
 * O Instagram frequentemente retorna erro transitório quando `media_publish` é
 * chamado no mesmo instante em que o container termina de processar — o container
 * fica publicável apenas alguns segundos depois. O reels-publish chamava
 * media_publish UMA única vez e engolia o erro (`.id || null`), marcando o reel
 * como `failed` (ig_poll_timeout) mesmo estando pronto. Um retry manual ~30s
 * depois publicava na hora. Este helper adiciona retry com backoff e expõe o erro
 * real para diagnóstico.
 *
 * `delayMs` é parametrizável só para os testes rodarem sem espera real.
 */
export async function publishFinishedContainer(
  igApiBase: string,
  igUserId: string,
  igToken: string,
  creationId: string,
  delayMs = 3000,
  maxAttempts = 5,
): Promise<{ id: string | null; error: string | null }> {
  let lastError: string | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }

    // Had no timeout at all before — a hung media_publish call blocked the whole retry loop
    // indefinitely, uncounted by maxAttempts (which only limits ITERATIONS, not wall clock).
    let data: { id?: string; error?: { message?: string; code?: number } }
    try {
      const res = await fetch(`${igApiBase}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: igToken }),
        signal: AbortSignal.timeout(10_000),
      })
      try {
        data = (await res.json()) as typeof data
      } catch {
        data = {}
      }
      if (!data.id) {
        lastError = data.error
          ? `${data.error.code ?? ''} ${data.error.message ?? ''}`.trim()
          : `http_${res.status}`
      }
    } catch (err) {
      data = {}
      lastError = err instanceof Error ? err.message : String(err)
    }

    if (data.id) {
      return { id: data.id, error: null }
    }

    console.error(
      `[publishFinishedContainer] tentativa ${attempt + 1}/${maxAttempts} falhou: ${lastError}`,
    )
  }

  return { id: null, error: lastError }
}
