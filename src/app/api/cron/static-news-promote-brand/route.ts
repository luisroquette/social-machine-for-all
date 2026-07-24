export const maxDuration = 120

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getNumericVariable } from '@/lib/settings/load-settings'
import { generateTextWithFallback } from '@/lib/ai/generate-with-fallback'
import { parseAIJson } from '@/lib/ai/parse-json'
import { buildStaticNewsPrompt, chooseStaticNewsDraftFormat, type StaticNewsDraft, type StaticNewsQueueItem } from '@/lib/pipeline/brand-static-news'

const WORKSPACE_ID = process.env.WORKSPACE_ID?.trim() ?? ''

type CuratedStaticSlide = {
  type: 'cover' | 'content' | 'cta'
  headline: string
  body?: string
  context?: string
  kpi?: string
}

function normalizeDraft(item: StaticNewsQueueItem, parsed: Record<string, unknown>): StaticNewsDraft {
  const targetFormat = chooseStaticNewsDraftFormat(item)

  if (item.media_mode === 'curated_image') {
    const caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : ''
    const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : ''
    const context = typeof parsed.context === 'string' ? parsed.context.trim() : ''
    const eyebrow = typeof parsed.eyebrow === 'string' ? parsed.eyebrow.trim() : ''
    const imagePrompt = typeof parsed.image_prompt === 'string' ? parsed.image_prompt.trim() : ''
    const kpi = typeof parsed.kpi === 'string' ? parsed.kpi.trim() : ''

    if (!caption || !eyebrow || !imagePrompt) throw new Error('static_news_curated_fields_missing')

    if (targetFormat === 'feed_post') {
      if (!headline || !context) throw new Error('static_news_curated_post_fields_missing')
      return {
        target_format: 'feed_post',
        content: JSON.stringify({
          format: 'feed_post',
          visual_mode: 'curated_image',
          eyebrow,
          headline,
          context,
          kpi: kpi || undefined,
          image_prompt: imagePrompt,
          caption,
        }),
      }
    }

    const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : []
    const slides = rawSlides
      .map((slide): CuratedStaticSlide | null => {
        if (!slide || typeof slide !== 'object') return null
        const data = slide as Record<string, unknown>
        const type = data.type === 'cover' || data.type === 'content' || data.type === 'cta' ? data.type : 'content'
        const slideHeadline = typeof data.headline === 'string' ? data.headline.trim() : ''
        const body = typeof data.body === 'string' ? data.body.trim() : undefined
        const slideContext = typeof data.context === 'string' ? data.context.trim() : undefined
        const slideKpi = typeof data.kpi === 'string' ? data.kpi.trim() : undefined
        if (!slideHeadline) return null
        return { type, headline: slideHeadline, body, context: slideContext, kpi: slideKpi }
      })
      .filter((slide): slide is CuratedStaticSlide => slide !== null)

    if (slides.length !== item.image_urls.length) {
      throw new Error('static_news_curated_slide_count_mismatch')
    }

    return {
      target_format: targetFormat,
      content: JSON.stringify({
        format: targetFormat,
        visual_mode: 'curated_image',
        eyebrow,
        image_prompt: imagePrompt,
        slides,
        caption,
      }),
    }
  }

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : ''
  const context = typeof parsed.context === 'string' ? parsed.context.trim() : ''
  const imagePrompt = typeof parsed.image_prompt === 'string' ? parsed.image_prompt.trim() : ''
  const caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : ''
  const kpi = typeof parsed.kpi === 'string' ? parsed.kpi.trim() : ''

  if (!headline || !context || !imagePrompt || !caption) {
    throw new Error('static_news_generated_image_fields_missing')
  }

  return {
    target_format: 'feed_post',
    content: JSON.stringify({
      format: 'feed_post',
      headline,
      context,
      kpi: kpi || undefined,
      image_prompt: imagePrompt,
      caption,
    }),
  }
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!WORKSPACE_ID) {
    return NextResponse.json({ error: 'WORKSPACE_ID is not configured' }, { status: 503 })
  }

  const [candidateLimit] = await Promise.all([
    getNumericVariable(WORKSPACE_ID, 'reel_candidate_limit'),
  ])

  const supabase = getAdminClient()
  const { data: queueItems, error } = await supabase
    .from('instagram_static_news_queue')
    .select('id, curated_content_id, workspace_id, source_platform, source_url, source_author, source_content, source_metrics, launch_category, launch_score, launch_reasons, media_mode, image_urls, primary_image_url, metadata')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'queued')
    .limit(candidateLimit || 10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!queueItems?.length) {
    return NextResponse.json({ ok: true, promoted: 0, skipped: 'no_queued_static_news' })
  }

  const promoted: string[] = []
  const skippedReasons: Record<string, number> = {}

  const rankedItems = (queueItems as unknown as StaticNewsQueueItem[])
    .sort((a, b) => {
      const aPriority = a.metadata?.editorial_priority_score ?? a.launch_score
      const bPriority = b.metadata?.editorial_priority_score ?? b.launch_score
      return bPriority - aPriority
    })

  for (const rawItem of rankedItems) {
    const { count: existingDrafts } = await supabase
      .from('generated_content')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('curated_content_id', rawItem.curated_content_id)
      .eq('target_platform', 'instagram')
      .not('status', 'eq', 'rejected')

    if ((existingDrafts ?? 0) > 0) {
      skippedReasons.duplicate = (skippedReasons.duplicate ?? 0) + 1
      continue
    }

    try {
      const targetFormat = chooseStaticNewsDraftFormat(rawItem)
      const aiText = await generateTextWithFallback({
        system: 'Retorne apenas JSON válido, sem markdown.',
        prompt: buildStaticNewsPrompt(rawItem, targetFormat),
        temperature: 0.6,
        maxOutputTokens: 1200,
      })
      const parsed = parseAIJson<Record<string, unknown>>(aiText, `static-news ${rawItem.id}`)
      const draft = normalizeDraft(rawItem, parsed)

      const { error: insertError } = await supabase.from('generated_content').insert({
        workspace_id: WORKSPACE_ID,
        curated_content_id: rawItem.curated_content_id,
        target_platform: 'instagram',
        target_format: draft.target_format,
        content: draft.content,
        status: 'draft',
        review_score: null,
        review_feedback: 'Aguardando revisão editorial obrigatória',
        review_issues: [],
        metadata: {
          static_news: true,
          media_mode: rawItem.media_mode,
          launch_category: rawItem.launch_category,
          launch_score: rawItem.launch_score,
          launch_reasons: rawItem.launch_reasons,
          editorial_priority_score: rawItem.metadata?.editorial_priority_score ?? rawItem.launch_score,
          b2b_angle: rawItem.metadata?.b2b_angle ?? null,
          primary_image_url: rawItem.primary_image_url,
          image_urls: rawItem.image_urls,
        },
      })

      if (insertError) {
        skippedReasons.insert_error = (skippedReasons.insert_error ?? 0) + 1
        continue
      }

      await supabase
        .from('instagram_static_news_queue')
        .update({ status: 'promoted' })
        .eq('id', rawItem.id)

      promoted.push(rawItem.id)
    } catch {
      skippedReasons.ai_or_parse_error = (skippedReasons.ai_or_parse_error ?? 0) + 1
    }
  }

  return NextResponse.json({
    ok: true,
    promoted: promoted.length,
    promotedIds: promoted,
    skippedReasons,
  })
}
