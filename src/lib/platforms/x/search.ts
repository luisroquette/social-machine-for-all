import { XClient } from './client'

export interface TweetSearchResult {
  id: string
  text: string
  authorHandle: string
  authorName: string | null
  authorFollowers: number
  authorFollowing: number
  authorVerified: boolean
  createdAt: string
  metrics: { likes: number; retweets: number; replies: number; views: number; quotes: number }
  mediaUrls: string[]
  mediaTypes: string[]  // 'photo', 'video', 'animated_gif'
  hasMedia: boolean
  hasExternalLink: boolean
  tweetUrl: string
  videoUrl: string | null
}

/**
 * Specialized search function for the Curator agent.
 * Wraps XClient.search() and maps results to a richer TweetSearchResult format
 * with media details extracted from the API response.
 */
export async function searchTweets(
  query: string,
  maxResults = 10,
  sinceId?: string,
): Promise<TweetSearchResult[]> {
  const client = XClient.fromEnv()

  const posts = await client.search({ query, maxResults, sinceId })

  return posts.map((post) => {
    // Extract extended fields from XClient (must be first — used below)
    const ext = post as typeof post & {
      mediaUrls?: string[]; mediaTypes?: string[]; videoUrl?: string | null
      authorFollowers?: number; authorFollowing?: number;
      authorVerified?: boolean; quoteCount?: number
    }
    const mediaUrls = ext.mediaUrls || []

    // Use mediaTypes from XClient if available (accurate), otherwise infer from URLs
    const mediaTypes: string[] = ext.mediaTypes?.length
      ? ext.mediaTypes
      : mediaUrls.map((url) => {
          if (/video/i.test(url)) return 'video'
          if (/tweet_video_thumb|ext_tw_video_thumb|amplify_video/i.test(url)) return 'video'
          if (/gif/i.test(url)) return 'animated_gif'
          return 'photo'
        })

    // Check for external links (not just x.com/twitter.com)
    const hasExternalLink = (post.text.match(/https?:\/\/\S+/g) ?? []).some(url => {
      const lower = url.toLowerCase()
      if (lower.includes('t.co/')) return true
      if (lower.includes('twitter.com') || lower.includes('x.com')) return false
      return true
    })

    return {
      id: post.id,
      text: post.text,
      authorHandle: post.author,
      authorName: null,
      authorFollowers: ext.authorFollowers ?? 0,
      authorFollowing: ext.authorFollowing ?? 0,
      authorVerified: ext.authorVerified ?? false,
      createdAt: post.createdAt,
      metrics: {
        likes: post.metrics.likes,
        retweets: post.metrics.retweets,
        replies: post.metrics.replies,
        views: post.metrics.views,
        quotes: ext.quoteCount ?? 0,
      },
      mediaUrls,
      mediaTypes,
      hasMedia: mediaUrls.length > 0,
      hasExternalLink,
      tweetUrl: post.url,
      videoUrl: ext.videoUrl ?? null,
    }
  })
}
