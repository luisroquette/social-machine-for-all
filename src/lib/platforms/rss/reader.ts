/**
 * RSS/Atom feed reader — pull-based news curation.
 * Supports RSS 2.0 and Atom 1.0. No external XML library needed.
 * Used by curator Source 6 (news feeds) for Brand and other workspaces.
 */

export interface RssItem {
  title: string
  link: string
  description: string  // first 500 chars of content/summary
  pubDate: Date
  author: string
  feedTitle: string    // name of the originating feed
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract text from first occurrence of an XML tag (handles CDATA). */
function extractTag(xml: string, tag: string): string | null {
  // Handle self-closing tags like <link href="..."/>
  const selfClose = new RegExp(`<${tag}[^>]+href=["']([^"']+)["']`, 'i')
  const scMatch = selfClose.exec(xml)
  if (scMatch) return scMatch[1]

  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = re.exec(xml)
  if (!m) return null
  return stripCdata(m[1]).trim()
}

function stripCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[\s*/i, '').replace(/\s*\]\]>\s*$/i, '').trim()
}

/** Strip HTML tags for plain-text description. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function parseDate(raw: string | null): Date {
  if (!raw) return new Date()
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date() : d
}

/**
 * Parse RSS 2.0 or Atom 1.0 feed XML into RssItem[].
 * Returns up to maxItems most-recent items.
 */
export function parseFeed(xml: string, feedTitle: string, maxItems = 10): RssItem[] {
  const isAtom = /<feed[^>]+xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml)
  const itemTag = isAtom ? 'entry' : 'item'

  const items: RssItem[] = []
  const itemRe = new RegExp(`<${itemTag}[\\s>][\\s\\S]*?<\\/${itemTag}>`, 'g')
  let match

  while ((match = itemRe.exec(xml)) !== null) {
    if (items.length >= maxItems) break
    const block = match[0]

    const title = extractTag(block, 'title') ?? ''
    // RSS: <link>url</link> or just text node; Atom: <link href="url"/>
    const link = (isAtom ? extractTag(block, 'link') : null)
      ?? extractTag(block, 'link')
      ?? ''
    const rawDesc = extractTag(block, isAtom ? 'summary' : 'description')
      ?? extractTag(block, 'content:encoded')
      ?? extractTag(block, 'content')
      ?? ''
    const description = stripHtml(rawDesc).slice(0, 500)
    const pubDateRaw = extractTag(block, isAtom ? 'updated' : 'pubDate')
      ?? extractTag(block, 'published')
    const pubDate = parseDate(pubDateRaw)
    const author = extractTag(block, isAtom ? 'name' : 'dc:creator')
      ?? extractTag(block, 'author')
      ?? feedTitle

    if (!title || !link) continue
    items.push({ title, link, description, pubDate, author: stripHtml(author), feedTitle })
  }

  return items
}

/**
 * Fetch and parse an RSS/Atom feed URL.
 * Returns [] on any error (network, parse, quota).
 */
export async function fetchRssFeed(url: string, feedTitle: string, maxItems = 10): Promise<RssItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SocialMachine/3.1 RSS reader (+https://brand.com.br)' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, feedTitle, maxItems)
  } catch {
    return []
  }
}
