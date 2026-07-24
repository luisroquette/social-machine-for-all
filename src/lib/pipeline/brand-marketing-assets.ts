import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { InstagramClient, splitHashtags } from '@/lib/platforms/instagram/client'
import { buildStoryQueuePatch } from '@/lib/agents/publisher/index'

interface MarketingAssetRow {
  id: string
  public_url: string
  caption: string
  pillar: string
}

/**
 * Publica o asset real (pré-desenhado, pasta Marketing) mais antigo ainda não usado
 * do @brand. A imagem já é final — sem geração de IA, sem passar por
 * writer/reviewer — só a legenda pré-escrita é publicada junto.
 */
export async function publishNextMarketingAsset(
  workspaceId: string,
): Promise<{ success: boolean; assetId: string; postUrl?: string; error?: string } | null> {
  const supabase = getAdminClient()

  const { data: asset, error: fetchError } = await supabase
    .from('brand_marketing_assets')
    .select('id, public_url, caption, pillar')
    .eq('workspace_id', workspaceId)
    .is('used_at', null)
    // Assets fixados numa data comemorativa (seasonal_slug) NUNCA entram no pool
    // round-robin genérico — só o cron seasonal-brand pode publicá-los, na data
    // certa. Sem este filtro, "Feliz Natal" pode sair publicado em pleno julho.
    .is('seasonal_slug', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (fetchError || !asset) {
    return null
  }

  return publishMarketingAssetRow(supabase, workspaceId, asset)
}

/**
 * Núcleo de publicação de um asset já selecionado (moldura 3:4 → Instagram →
 * used_at → generated_content → Story). Compartilhado pelo pool round-robin
 * (publishNextMarketingAsset) e pelo agendamento por data comemorativa
 * (brand-seasonal-dates.ts, que seleciona por seasonal_slug em vez de mais antigo).
 */
export async function publishMarketingAssetRow(
  supabase: SupabaseClient,
  workspaceId: string,
  asset: MarketingAssetRow,
): Promise<{ success: boolean; assetId: string; postUrl?: string; error?: string }> {
  const igCreds = await getInstagramCredentials(workspaceId)
  if (!igCreds.igUserId || !igCreds.accessToken) {
    return { success: false, assetId: asset.id, error: 'Instagram credentials not configured for this workspace' }
  }

  const igClient = InstagramClient.fromWorkspace(igCreds)
  const { cleanCaption, hashtags } = splitHashtags(asset.caption)
  const altText = cleanCaption.split('\n')[0].replace(/[#@]/g, '').trim().slice(0, 100)
  // Moldura 3:4: a grade do IG é 3:4 e cortaria as laterais do asset 1:1.
  // brand-asset-frame centraliza o design inteiro num canvas 1080x1440.
  const frameUrl = `${getBaseUrl()}/api/og/brand-asset-frame?img=${encodeURIComponent(asset.public_url)}`
  // Padrão do repo: renderizar → persistir no Storage → publicar URL estável
  // (o fetcher da Meta pode estourar timeout na rota edge fria). Se o render
  // ou upload falhar, cai para a própria rota como fallback.
  let frameToPublish = frameUrl
  try {
    const frameRes = await fetch(frameUrl, { signal: AbortSignal.timeout(20_000) })
    if (frameRes.ok) {
      const framePng = new Uint8Array(await frameRes.arrayBuffer())
      const framePath = `marketing-frames/${asset.id}.png`
      const { error: frameUpErr } = await supabase.storage
        .from('brand-mob')
        .upload(framePath, framePng, { contentType: 'image/png', upsert: true })
      if (!frameUpErr) {
        frameToPublish = supabase.storage.from('brand-mob').getPublicUrl(framePath).data.publicUrl
      }
    }
  } catch (err) {
    console.warn('[brand-marketing-assets] frame render/upload falhou — publicando via rota edge', err instanceof Error ? err.message : err)
  }
  const result = await igClient.publishImage(cleanCaption, frameToPublish, altText)

  if (!result.success) {
    const qualityRejected = result.qualityReview?.outcome === 'rejected'
    // Falha técnica pode tentar novamente; reprovação editorial é registrada e quarentenada abaixo.
    const { error: failInsertError } = await supabase.from('generated_content').insert({
      workspace_id: workspaceId,
      target_platform: 'instagram',
      target_format: 'post',
      content: asset.caption,
      status: qualityRejected ? 'rejected' : 'failed',
      review_score: result.qualityReview?.score ?? null,
      review_feedback: result.qualityReview?.feedback ?? result.error ?? 'unknown error',
      review_issues: result.qualityReview?.issues ?? [],
      metadata: result.qualityReview ? { final_quality_review: result.qualityReview, marketing_asset_id: asset.id } : null,
    })
    if (failInsertError) {
      console.error('[brand-marketing-assets] failed to record failed publish in generated_content', { assetId: asset.id, error: failInsertError.message })
    }
    if (qualityRejected) {
      // Quarentena: evita que o mesmo asset reprovado seja reavaliado e cobrado em todo cron.
      await supabase.from('brand_marketing_assets').update({ used_at: new Date().toISOString() }).eq('id', asset.id)
    }
    return { success: false, assetId: asset.id, error: result.error }
  }

  if (result.postId && hashtags) {
    igClient.postComment(result.postId, hashtags).catch(() => {})
  }

  const { error: usedAtError } = await supabase.from('brand_marketing_assets').update({ used_at: new Date().toISOString() }).eq('id', asset.id)
  if (usedAtError) {
    console.error('[brand-marketing-assets] failed to mark asset as used after successful publish — risk of duplicate publish on next run', { assetId: asset.id, error: usedAtError.message })
  }

  const { data: inserted, error: insertError } = await supabase
    .from('generated_content')
    .insert({
      workspace_id: workspaceId,
      target_platform: 'instagram',
      target_format: 'post',
      content: asset.caption,
      status: 'published',
      published_id: result.postId ?? null,
      published_url: result.postUrl ?? null,
      published_at: new Date().toISOString(),
      review_score: result.qualityReview?.score ?? null,
      review_feedback: result.qualityReview?.feedback ?? null,
      review_issues: result.qualityReview?.issues ?? [],
      metadata: result.qualityReview ? { final_quality_review: result.qualityReview, marketing_asset_id: asset.id } : null,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[brand-marketing-assets] failed to record published post in generated_content — Story queueing skipped', { assetId: asset.id, error: insertError.message })
  }

  if (inserted?.id) {
    supabase.from('generated_content').update(buildStoryQueuePatch(asset.public_url)).eq('id', inserted.id).then(() => {}, () => {})
  }

  return { success: true, assetId: asset.id, postUrl: result.postUrl }
}
