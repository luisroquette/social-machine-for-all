import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { CLEANUP_TARGETS, isExpired, listAllFiles } from '@/lib/monitoring/storage-cleanup-policy'

export const maxDuration = 60

/**
 * Cron: Clean up old files from Supabase Storage.
 * Política de retenção (pastas, buckets e prazos): src/lib/monitoring/storage-cleanup-policy.ts
 * — módulo puro com regression tests que quebram o build se a cobertura regredir.
 *
 * Schedule: daily at 07:00 UTC (vercel.json)
 */
export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()
  let totalDeleted = 0
  const deletedByFolder: Record<string, number> = {}
  const errors: string[] = []
  const now = Date.now()

  for (const target of CLEANUP_TARGETS) {
    try {
      // list() do Supabase ordena por nome e trunca no limit — listAllFiles pagina
      // até o fim para nenhum arquivo antigo ficar invisível (bug histórico: 120+
      // vídeos de downloads/ além da página 1 nunca eram limpos).
      const files = await listAllFiles(async (offset, limit) => {
        const { data, error } = await supabase.storage
          .from(target.bucket)
          .list(target.folder, { limit, offset })
        if (error) throw new Error(error.message)
        return data ?? []
      })

      const expired = files.filter((f) => isExpired(f.created_at, target.retentionDays, now))
      if (expired.length === 0) continue

      // remove() em lotes de 100 — payloads grandes demais falham silenciosamente
      for (let i = 0; i < expired.length; i += 100) {
        const batch = expired.slice(i, i + 100).map((f) => `${target.folder}/${f.name}`)
        const { error: deleteError } = await supabase.storage.from(target.bucket).remove(batch)
        if (deleteError) {
          errors.push(`Delete ${target.bucket}/${target.folder}: ${deleteError.message}`)
          break
        }
        totalDeleted += batch.length
        deletedByFolder[`${target.bucket}/${target.folder}`] =
          (deletedByFolder[`${target.bucket}/${target.folder}`] ?? 0) + batch.length
      }
    } catch (err) {
      errors.push(`${target.bucket}/${target.folder}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Reset AI sentinel skip_reasons that have expired ──
  // ai_rate_limited: 4h cooldown; ai_unavailable: 2h cooldown
  // Items past their skip_until are eligible for retry — clear the sentinel.
  let sentinelReset = 0
  try {
    const { data: expired, error: expiredErr } = await supabase
      .from('curated_content')
      .select('id')
      .in('skip_reason', ['ai_rate_limited', 'ai_unavailable', 'publish_failed'])
      .lt('skip_until', new Date().toISOString())
    if (expiredErr) {
      errors.push(`sentinel-reset list: ${expiredErr.message}`)
    } else if (expired?.length) {
      const ids = expired.map((r) => r.id)
      const { error: clearErr } = await supabase
        .from('curated_content')
        .update({ skip_reason: null, skip_until: null })
        .in('id', ids)
      if (clearErr) {
        errors.push(`sentinel-reset clear: ${clearErr.message}`)
      } else {
        sentinelReset = ids.length
        console.log(`[cleanup] sentinel-reset: cleared ${ids.length} expired AI skip_reasons`)
      }
    }
  } catch (err) {
    errors.push(`sentinel-reset: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (totalDeleted > 0) console.log(`[cleanup] deleted ${totalDeleted}:`, deletedByFolder)

  return NextResponse.json({
    ok: true,
    deleted: totalDeleted,
    deletedByFolder,
    sentinelReset,
    errors: errors.length > 0 ? errors : undefined,
  })
}
