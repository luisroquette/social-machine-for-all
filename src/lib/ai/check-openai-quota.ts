/**
 * Probe barato para detectar quota/billing ESGOTADA da OpenAI.
 *
 * Por que existe (16/06/2026):
 * A quota da OpenAI estourou e derrubou a geração das capas de reel por dias, sem
 * nenhum alerta — o heartbeat checava token IG e créditos do Twitter, mas não a
 * OpenAI. Este probe fecha essa lacuna de monitoramento.
 *
 * Faz uma chamada mínima (gpt-4o-mini, 1 token, ~fração de centavo) e retorna true
 * SOMENTE em 429 de quota/billing (insufficient_quota). NUNCA retorna true em
 * rate-limit transitório, erro de rede ou 5xx — para não disparar alerta crítico à
 * toa. insufficient_quota é a nível de conta (billing), então o probe de texto
 * detecta corretamente o problema que também trava o gpt-image-1.
 */
export async function isOpenAiQuotaExceeded(apiKey: string, timeoutMs = 15_000): Promise<boolean> {
  if (!apiKey) return false
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (res.status !== 429) return false

    // 429 pode ser rate-limit (transitório) OU insufficient_quota (billing). Só o
    // segundo é alerta crítico — distinguir pelo corpo do erro.
    const body = await res.text()
    return /insufficient_quota|exceeded your current quota|billing hard limit/i.test(body)
  } catch {
    // timeout / rede / parse → transitório, não alerta
    return false
  }
}
