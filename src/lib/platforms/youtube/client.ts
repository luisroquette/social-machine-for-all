/**
 * YouTube Data API v3 client.
 * Publishes Shorts (vertical videos ≤60s) via resumable upload.
 */

interface YouTubeCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  channelId: string
}

interface YouTubePublishResult {
  success: boolean
  videoId?: string
  videoUrl?: string
  error?: string
}

export class YouTubeClient {
  private credentials: YouTubeCredentials
  private accessToken: string | null = null
  private tokenExpiresAt = 0

  constructor(credentials: YouTubeCredentials) {
    this.credentials = credentials
  }

  static fromEnv(): YouTubeClient {
    return new YouTubeClient({
      clientId: process.env.YOUTUBE_CLIENT_ID!,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET!,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN!,
      channelId: process.env.YOUTUBE_CHANNEL_ID!,
    })
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`YouTube token refresh failed: ${res.status} — ${err}`)
    }

    const data = await res.json() as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken
  }

  /**
   * Upload a video as a YouTube Short.
   * Videos must be vertical (9:16) and ≤60s for Shorts.
   * Longer videos are published as regular videos.
   */
  async publishShort(
    title: string,
    description: string,
    videoUrl: string,
    tags: string[] = []
  ): Promise<YouTubePublishResult> {
    try {
      const token = await this.getAccessToken()

      // 1. Download video to buffer
      const vidRes = await fetch(videoUrl)
      if (!vidRes.ok) return { success: false, error: `Video download failed: ${vidRes.status}` }
      const vidBuffer = Buffer.from(await vidRes.arrayBuffer())

      // 2. Determine if Short (add #Shorts to title for ≤60s vertical videos)
      const shortTitle = title.length <= 95 ? `${title} #Shorts` : title

      // 3. Start resumable upload
      const initRes = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Length': String(vidBuffer.length),
            'X-Upload-Content-Type': 'video/mp4',
          },
          body: JSON.stringify({
            snippet: {
              title: shortTitle,
              description,
              tags,
              categoryId: '28', // Science & Technology
              defaultLanguage: 'pt-BR',
              defaultAudioLanguage: 'pt-BR',
            },
            status: {
              privacyStatus: 'public',
              selfDeclaredMadeForKids: false,
            },
          }),
        }
      )

      if (!initRes.ok) {
        const err = await initRes.text()
        return { success: false, error: `Upload init failed: ${initRes.status} — ${err}` }
      }

      const uploadUrl = initRes.headers.get('location')
      if (!uploadUrl) return { success: false, error: 'No upload URL returned' }

      // 4. Upload video data
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(vidBuffer.length),
        },
        body: vidBuffer,
      })

      if (!uploadRes.ok) {
        const err = await uploadRes.text()
        return { success: false, error: `Upload failed: ${uploadRes.status} — ${err}` }
      }

      const videoData = await uploadRes.json() as { id: string }
      const videoId = videoData.id

      console.log(`[youtube] Published: ${videoId}`)

      return {
        success: true,
        videoId,
        videoUrl: `https://youtube.com/shorts/${videoId}`,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
