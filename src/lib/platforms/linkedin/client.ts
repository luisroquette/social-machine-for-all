/**
 * LinkedIn API client.
 * Posts text and articles via the LinkedIn Marketing API.
 * Uses OAuth 2.0 with w_member_social permission.
 */

import type { PlatformAdapter, PublishResult, SearchOptions, PlatformPost } from '../platform-adapter'

interface LinkedInCredentials {
  accessToken: string
  personUrn?: string  // urn:li:person:{id}
}

const API_BASE = 'https://api.linkedin.com/v2'
const REST_BASE = 'https://api.linkedin.com/rest'

export class LinkedInClient implements PlatformAdapter {
  readonly platform = 'linkedin'
  private credentials: LinkedInCredentials
  private cachedPersonUrn: string | null = null

  constructor(credentials: LinkedInCredentials) {
    this.credentials = credentials
  }

  static fromEnv(): LinkedInClient {
    return new LinkedInClient({
      accessToken: process.env.LINKEDIN_ACCESS_TOKEN!,
      personUrn: process.env.LINKEDIN_PERSON_URN,
    })
  }

  /**
   * Get the authenticated user's person URN.
   */
  private async getPersonUrn(): Promise<string> {
    if (this.credentials.personUrn) return this.credentials.personUrn
    if (this.cachedPersonUrn) return this.cachedPersonUrn

    const res = await fetch(`${API_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
    })

    if (!res.ok) {
      throw new Error(`Failed to get LinkedIn profile: ${res.status}`)
    }

    const data = await res.json()
    this.cachedPersonUrn = `urn:li:person:${data.sub}`
    return this.cachedPersonUrn!
  }

  /**
   * Publish a text post to LinkedIn.
   * LinkedIn supports up to 3000 characters per post.
   */
  async publish(text: string): Promise<PublishResult> {
    const personUrn = await this.getPersonUrn()

    const res = await fetch(`${REST_BASE}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202601',
      },
      body: JSON.stringify({
        author: personUrn,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      return { success: false, error: `LinkedIn publish failed: ${res.status} — ${error}` }
    }

    // LinkedIn returns post URN in x-restli-id header
    const postUrn = res.headers.get('x-restli-id') ?? ''
    const postId = postUrn.split(':').pop() ?? ''

    return {
      success: true,
      postId,
      postUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
    }
  }

  /**
   * Publish a post with an article link to LinkedIn.
   */
  async publishWithLink(text: string, linkUrl: string, linkTitle?: string): Promise<PublishResult> {
    const personUrn = await this.getPersonUrn()

    const res = await fetch(`${REST_BASE}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202601',
      },
      body: JSON.stringify({
        author: personUrn,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          article: {
            source: linkUrl,
            title: linkTitle ?? '',
          },
        },
        lifecycleState: 'PUBLISHED',
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      return { success: false, error: `LinkedIn publish failed: ${res.status} — ${error}` }
    }

    const postUrn = res.headers.get('x-restli-id') ?? ''

    return {
      success: true,
      postId: postUrn.split(':').pop() ?? '',
      postUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
    }
  }

  // PlatformAdapter interface methods
  async search(_options: SearchOptions): Promise<PlatformPost[]> {
    // LinkedIn doesn't have a public search API
    return []
  }

  async reply(_postId: string, _text: string): Promise<PublishResult> {
    return { success: false, error: 'LinkedIn reply not implemented' }
  }

  async like(_postId: string): Promise<boolean> {
    return false
  }
}
