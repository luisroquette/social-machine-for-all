import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

function slugify(value: string) {
  return value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const keywords = Array.isArray(body.topicKeywords)
    ? body.topicKeywords.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim()).filter(Boolean).slice(0, 20)
    : []
  const slug = slugify(typeof body.slug === 'string' ? body.slug : name)
  if (!name || !slug) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const admin = getAdminClient()
  const { data: existing } = await admin.from('workspaces').select('id').eq('owner_id', user.id).limit(1)
  if (existing?.length) return NextResponse.json({ error: 'A workspace already exists for this user.' }, { status: 409 })

  const { data, error } = await admin.from('workspaces').insert({
    name,
    slug,
    description: description || null,
    topic_keywords: keywords,
    brand_config: {},
    owner_id: user.id,
    active: true,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workspaceId: data.id }, { status: 201 })
}
