export const maxDuration = 300

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { generateArticle } from '@/lib/agents/writer/article-writer'

export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, model } = await request.json()

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const result = await generateArticle(
    workspaceId,
    model ?? 'deepseek-chat',
  )

  return NextResponse.json(result)
}
