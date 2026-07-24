import { cookies } from 'next/headers'

/**
 * Default workspace ID — env var fallback for crons/agents/infra.
 * Dashboard UI uses getActiveWorkspaceId() instead.
 */
export const WORKSPACE_ID = process.env.WORKSPACE_ID?.trim() || ''

/**
 * Returns the active workspace for the current request.
 * Reads cookie set by WorkspaceSwitcher, falls back to WORKSPACE_ID.
 * Use in Server Components and Route Handlers only.
 */
export async function getActiveWorkspaceId(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('active_workspace_id')?.value ?? WORKSPACE_ID
}
