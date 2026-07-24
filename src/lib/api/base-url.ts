/**
 * Get the base URL for internal API calls.
 * Priority:
 * 1. APP_BASE_URL — explicitly configured, always wins (handles custom domain + SSO bypass)
 * 2. VERCEL_URL — deployment-specific, SSO-protected (use with x-vercel-protection-bypass header)
 * 3. localhost fallback
 *
 * Note: VERCEL_PROJECT_PRODUCTION_URL is intentionally skipped — it points to
 * socialmachine.ia.br which may not have DNS/SSL configured yet.
 */
export function getBaseUrl(): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}
