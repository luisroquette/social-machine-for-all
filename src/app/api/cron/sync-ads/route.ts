export const maxDuration = 120

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'

import { WORKSPACE_ID } from '@/lib/config/workspace'

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = process.env.META_ADS_ACCESS_TOKEN
  if (!accessToken) {
    return NextResponse.json({ error: 'META_ADS_ACCESS_TOKEN not configured' }, { status: 500 })
  }

  const supabase = getAdminClient()

  // Load account IDs from workspace settings
  const { data: accountSetting } = await supabase
    .from('workspace_settings')
    .select('value')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('category', 'platform')
    .eq('key', 'meta_ads_account_ids')
    .single()

  const accountIds = (accountSetting?.value as string ?? '')
    .split(',')
    .map((id: string) => id.trim())
    .filter(Boolean)

  if (accountIds.length === 0) {
    return NextResponse.json({ message: 'No Meta Ads accounts configured' })
  }

  const results = { accountsSynced: 0, campaignsSynced: 0, performanceDays: 0, errors: [] as string[] }

  for (const accountId of accountIds) {
    try {
      // Fetch campaigns
      const campaignsUrl = `https://graph.facebook.com/v21.0/${accountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,objective&access_token=${accessToken}&limit=100`
      const campaignsRes = await fetch(campaignsUrl, { signal: AbortSignal.timeout(15_000) })
      if (!campaignsRes.ok) {
        results.errors.push(`${accountId}: API error ${campaignsRes.status}`)
        continue
      }

      const campaignsData = await campaignsRes.json()
      const campaigns = campaignsData.data ?? []

      // Upsert campaigns
      for (const c of campaigns) {
        const status = c.status === 'ACTIVE' ? 'active' : c.status === 'PAUSED' ? 'paused' : 'ended'
        const dailyBudget = c.daily_budget ? Number(c.daily_budget) / 100 : null

        const { data: existing } = await supabase
          .from('ad_campaigns')
          .select('id')
          .eq('workspace_id', WORKSPACE_ID)
          .eq('external_campaign_id', c.id)
          .single()

        if (existing) {
          await supabase.from('ad_campaigns').update({
            name: c.name, status, daily_budget: dailyBudget,
            last_synced_at: new Date().toISOString(),
            performance: { objective: c.objective },
          }).eq('id', existing.id)
        } else {
          await supabase.from('ad_campaigns').insert({
            workspace_id: WORKSPACE_ID, platform: 'meta',
            external_campaign_id: c.id, name: c.name, status,
            daily_budget: dailyBudget,
            last_synced_at: new Date().toISOString(),
            performance: { objective: c.objective },
          })
        }
        results.campaignsSynced++
      }

      // Fetch insights (last 7 days)
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const until = new Date().toISOString().split('T')[0]

      for (const c of campaigns) {
        try {
          const insightsUrl = `https://graph.facebook.com/v21.0/${c.id}/insights?fields=impressions,clicks,spend,actions,ctr,cpc,cost_per_action_type&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${accessToken}`
          const insightsRes = await fetch(insightsUrl, { signal: AbortSignal.timeout(15_000) })
          if (!insightsRes.ok) continue

          const insightsData = await insightsRes.json()
          const { data: dbCampaign } = await supabase
            .from('ad_campaigns')
            .select('id')
            .eq('workspace_id', WORKSPACE_ID)
            .eq('external_campaign_id', c.id)
            .single()

          if (!dbCampaign) continue

          for (const day of insightsData.data ?? []) {
            const conversions = (day.actions ?? []).find((a: { action_type: string; value: string }) =>
              a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'lead'
            )?.value ?? 0
            const spend = Number(day.spend) || 0
            const clicks = Number(day.clicks) || 0
            const impressions = Number(day.impressions) || 0

            await supabase.from('ad_performance').upsert({
              campaign_id: dbCampaign.id,
              date: day.date_start,
              impressions, clicks, spend,
              conversions: Number(conversions),
              ctr: Number(day.ctr) || 0,
              cpc: clicks > 0 ? spend / clicks : 0,
              cpa: Number(conversions) > 0 ? spend / Number(conversions) : 0,
              roas: 0,
              metadata: { raw_actions: day.actions },
            }, { onConflict: 'campaign_id,date' })

            results.performanceDays++
          }
        } catch (err) {
          results.errors.push(`Campaign ${c.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      results.accountsSynced++
    } catch (err) {
      results.errors.push(`${accountId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`[sync-ads] Synced ${results.accountsSynced} accounts, ${results.campaignsSynced} campaigns, ${results.performanceDays} perf days`)

  return NextResponse.json(results)
}
