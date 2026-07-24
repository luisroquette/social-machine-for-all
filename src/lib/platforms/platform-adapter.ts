export interface PlatformPost {
  id: string
  url: string
  text: string
  author: string
  conversationId?: string | null
  inReplyToId?: string | null
  inReplyToUsername?: string | null
  metrics: {
    likes: number
    retweets: number
    replies: number
    views: number
  }
  createdAt: string
}

export interface PublishResult {
  success: boolean
  postId?: string
  postUrl?: string
  error?: string
  qualityReview?: {
    outcome: 'approved' | 'rejected' | 'unavailable'
    passed: boolean
    score: number
    scores: Record<string, number | null>
    issues: string[]
    improvements: string[]
    feedback: string
  }
}

export interface SearchOptions {
  query: string
  maxResults?: number
  sinceId?: string
}

export interface PlatformAdapter {
  readonly platform: string

  /** Search for posts matching a query */
  search(options: SearchOptions): Promise<PlatformPost[]>

  /** Publish a new post */
  publish(text: string): Promise<PublishResult>

  /** Reply to an existing post */
  reply(postId: string, text: string): Promise<PublishResult>

  /** Like a post */
  like(postId: string): Promise<boolean>

  /** Get trending topics */
  getTrending?(woeid?: number): Promise<Array<{ name: string; tweetCount: number | null }> | string[]>
}
