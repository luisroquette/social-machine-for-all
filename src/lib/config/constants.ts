/**
 * Central constants — single source of truth.
 * Values come from env vars. There is deliberately no workspace fallback:
 * a public installation must never target an unknown account.
 */

export const WORKSPACE_ID = process.env.WORKSPACE_ID?.trim() || ''

export const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v22.0'
export const INSTAGRAM_API_BASE = `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`
