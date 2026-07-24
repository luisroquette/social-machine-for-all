/**
 * REGRESSÃO: extractMediaFromIoTweet — TwitterAPI.io media extraction
 *
 * Bug (mai/2026): tweets do Source 1 (TwitterAPI.io) entravam no curator com
 * mediaTypes=[] e videoUrl=null hardcoded. Isso fazia o reels-prepare nunca
 * encontrar candidatos com media_types=['video'], parando toda a produção de reels
 * do @thedoomguy_ai.
 *
 * Fix: extractMediaFromIoTweet() lê extendedEntities/entities da resposta real
 * da API em vez de retornar valores fixos vazios.
 */

import { describe, it, expect } from 'vitest'
import { extractMediaFromIoTweet, type TwitterApiIoTweet } from './twitterapi-io'

const baseTweet: TwitterApiIoTweet = {
  id: '123',
  text: 'test',
  createdAt: new Date().toISOString(),
  author: { userName: 'test', name: 'Test', id: '1' },
}

describe('REGRESSÃO: extractMediaFromIoTweet — Source 1 não descarta vídeos', () => {
  it('tweet sem mídia retorna arrays vazios', () => {
    const result = extractMediaFromIoTweet(baseTweet)
    expect(result.hasMedia).toBe(false)
    expect(result.mediaTypes).toEqual([])
    expect(result.videoUrl).toBeNull()
  })

  it('tweet com foto extrai mediaType=photo e mediaUrl', () => {
    const tweet: TwitterApiIoTweet = {
      ...baseTweet,
      extendedEntities: {
        media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo.jpg' }],
      },
    }
    const result = extractMediaFromIoTweet(tweet)
    expect(result.hasMedia).toBe(true)
    expect(result.mediaTypes).toContain('photo')
    expect(result.mediaUrls).toContain('https://pbs.twimg.com/media/photo.jpg')
    expect(result.videoUrl).toBeNull()
  })

  it('tweet com vídeo extrai mediaType=video e videoUrl (maior bitrate)', () => {
    const tweet: TwitterApiIoTweet = {
      ...baseTweet,
      extendedEntities: {
        media: [{
          type: 'video',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
              { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
            ],
          },
        }],
      },
    }
    const result = extractMediaFromIoTweet(tweet)
    expect(result.hasMedia).toBe(true)
    expect(result.mediaTypes).toContain('video')
    // 2176000 ≤ 2.5Mbps cap → deve ser escolhido
    expect(result.videoUrl).toBe('https://video.twimg.com/high.mp4')
  })

  it('usa entities como fallback se extendedEntities ausente', () => {
    const tweet: TwitterApiIoTweet = {
      ...baseTweet,
      entities: {
        media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/fallback.jpg' }],
      },
    }
    const result = extractMediaFromIoTweet(tweet)
    expect(result.hasMedia).toBe(true)
    expect(result.mediaTypes).toContain('photo')
  })

  it('extendedEntities tem prioridade sobre entities', () => {
    const tweet: TwitterApiIoTweet = {
      ...baseTweet,
      extendedEntities: {
        media: [{ type: 'video', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/ext.mp4' }] } }],
      },
      entities: {
        media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/ent.jpg' }],
      },
    }
    const result = extractMediaFromIoTweet(tweet)
    expect(result.mediaTypes).toContain('video')
    expect(result.videoUrl).toBe('https://video.twimg.com/ext.mp4')
    expect(result.mediaTypes).not.toContain('photo')
  })

  it('REGRESSÃO: vídeo 4K (>2.5Mbps) — escolhe 1080p em vez de 4K (bug 2026-05-22)', () => {
    // 4K Twitter videos (3-10Mbps) causavam Railway timeout e IG publish failure
    const tweet: TwitterApiIoTweet = {
      ...baseTweet,
      extendedEntities: {
        media: [{
          type: 'video',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/720p.mp4' },
              { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/1080p.mp4' },
              { content_type: 'video/mp4', bitrate: 6000000, url: 'https://video.twimg.com/4k.mp4' },
              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
            ],
          },
        }],
      },
    }
    const result = extractMediaFromIoTweet(tweet)
    expect(result.hasMedia).toBe(true)
    expect(result.mediaTypes).toContain('video')
    // NUNCA deve escolher 4K (6Mbps > 2.5Mbps cap)
    expect(result.videoUrl).not.toBe('https://video.twimg.com/4k.mp4')
    // Deve escolher 1080p (melhor qualidade dentro do cap)
    expect(result.videoUrl).toBe('https://video.twimg.com/1080p.mp4')
  })

  it('vídeo onde TODOS variants são >2.5Mbps — usa o menor disponível como fallback', () => {
    // Se só existem variantes 4K/8K, usa a menor (não falha completamente)
    const tweet: TwitterApiIoTweet = {
      ...baseTweet,
      extendedEntities: {
        media: [{
          type: 'video',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 4000000, url: 'https://video.twimg.com/4k-low.mp4' },
              { content_type: 'video/mp4', bitrate: 8000000, url: 'https://video.twimg.com/8k.mp4' },
            ],
          },
        }],
      },
    }
    const result = extractMediaFromIoTweet(tweet)
    expect(result.hasMedia).toBe(true)
    // Fallback: menor variante disponível (4Mbps)
    expect(result.videoUrl).toBe('https://video.twimg.com/4k-low.mp4')
  })
})
