import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isHiggsfieldConfigured,
  isHiggsfieldTextToVideoConfigured,
  pollHiggsfieldJob,
  startHiggsfieldTextToVideoJob,
} from './higgsfield'

describe('higgsfield adapter', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('detecta falta de configuracao', () => {
    delete process.env.HIGGSFIELD_API_BASE
    delete process.env.HIGGSFIELD_API_KEY
    delete process.env.HIGGSFIELD_API_KEY_ID
    delete process.env.HIGGSFIELD_API_SECRET_KEY
    delete process.env.HIGGSFIELD_TEXT_TO_VIDEO_CREATE_PATH
    expect(isHiggsfieldConfigured()).toBe(false)
    expect(isHiggsfieldTextToVideoConfigured()).toBe(false)
  })

  it('faz polling de job em processamento', async () => {
    process.env.HIGGSFIELD_API_BASE = 'https://api.example.com'
    process.env.HIGGSFIELD_API_KEY = 'key-id:secret-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'in_progress',
      }),
    }))

    const result = await pollHiggsfieldJob('job_123')
    expect(result).toMatchObject({
      ok: true,
      configured: true,
      status: 'processing',
      jobId: 'job_123',
    })
  })

  it('inicia text-to-video com path configurado', async () => {
    process.env.HIGGSFIELD_API_BASE = 'https://api.example.com'
    process.env.HIGGSFIELD_API_KEY = 'key-id:secret-key'
    process.env.HIGGSFIELD_TEXT_TO_VIDEO_CREATE_PATH = '/v1/video'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        request_id: 'job_t2v_123',
        status: 'queued',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await startHiggsfieldTextToVideoJob({
      prompt: 'filme vertical',
      model: 'seedance-2.0',
      durationSec: 10,
      aspectRatio: '9:16',
      referenceImages: ['https://img.example.com/ref.png'],
    })

    expect(result).toMatchObject({
      ok: true,
      configured: true,
      status: 'queued',
      jobId: 'job_t2v_123',
      provider: 'higgsfield',
      mode: 'text_to_video',
      model: 'seedance-2.0',
    })
    expect(result.requestParams).toEqual({
      model: 'seedance-2.0',
      prompt: 'filme vertical',
      duration_sec: 10,
      aspect_ratio: '9:16',
      input_images: [{ type: 'image_url', image_url: 'https://img.example.com/ref.png' }],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/video',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          params: {
            model: 'seedance-2.0',
            prompt: 'filme vertical',
            duration_sec: 10,
            aspect_ratio: '9:16',
            input_images: [{ type: 'image_url', image_url: 'https://img.example.com/ref.png' }],
          },
        }),
      }),
    )
  })

  it('retorna indisponivel quando text-to-video nao esta configurado', async () => {
    process.env.HIGGSFIELD_API_BASE = 'https://api.example.com'
    process.env.HIGGSFIELD_API_KEY = 'key-id:secret-key'
    delete process.env.HIGGSFIELD_TEXT_TO_VIDEO_CREATE_PATH

    const result = await startHiggsfieldTextToVideoJob({
      prompt: 'filme vertical',
      model: 'seedance-2.0',
      durationSec: 10,
    })

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      status: 'failed',
      error: 'higgsfield_text_to_video_unavailable',
    })
  })

  it('retorna erro amigavel quando faltam creditos', async () => {
    process.env.HIGGSFIELD_API_BASE = 'https://api.example.com'
    process.env.HIGGSFIELD_API_KEY = 'key-id:secret-key'
    process.env.HIGGSFIELD_TEXT_TO_VIDEO_CREATE_PATH = '/v1/video'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"detail":"Not enough credits"}',
    }))

    const result = await startHiggsfieldTextToVideoJob({
      prompt: 'filme vertical',
      model: 'seedance-2.0',
      durationSec: 8,
    })

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      status: 'failed',
      error: 'higgsfield_not_enough_credits',
    })
  })

  it('REGRESSAO: nunca faz image-to-video (start_image_url/input_images derivado de imagem)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'higgsfield.ts'), 'utf-8')
    expect(src).not.toMatch(/startHiggsfieldImageToVideoJob/)
    expect(src).not.toMatch(/HiggsfieldStartInput/)
    expect(src).not.toMatch(/image_to_video/)
  })
})
