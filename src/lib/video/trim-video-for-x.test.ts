import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// REGRESSÃO 21/07/2026: X rejeita vídeo com mais de 2 minutos (HTTP 403 "not allowed to
// post a video longer than 2 minutes") — achado real em produção, ~6% das falhas de
// publicação no X. trimVideoForXIfNeeded() sonda a duração via `ffmpeg -i` (sem output,
// sempre sai != 0, duração fica no stderr) e só reencoda/corta quando excede o limite —
// nunca reencoda vídeo que já está dentro do limite.

const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: unknown, res?: unknown) => void
    const file = args[0] as string
    const cmdArgs = args[1] as string[]
    Promise.resolve(mockExecFile(file, cmdArgs)).then(
      (res) => callback(null, res),
      (err) => callback(err)
    )
  },
}))

const mockWriteFile = vi.fn()
const mockReadFile = vi.fn()
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
  }
})

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ storage: { from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }) } }),
}))

const originalFetch = globalThis.fetch

function stderrError(stderr: string) {
  return Object.assign(new Error('ffmpeg exited with code 1'), { stderr })
}

describe('trimVideoForXIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockReadFile.mockResolvedValue(Buffer.from('fake-video-bytes'))
    mockUpload.mockResolvedValue({ error: null })
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://storage.test/x-trimmed/item.mp4' } })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('vídeo dentro do limite (90s) não é reencodado — só sonda a duração e retorna null', async () => {
    mockExecFile.mockRejectedValueOnce(stderrError('Duration: 00:01:30.00, start: 0.000000, bitrate: 128 kb/s'))
    const { trimVideoForXIfNeeded } = await import('./trim-video-for-x')
    const result = await trimVideoForXIfNeeded('https://video.test/short.mp4', 'item-short')
    expect(result).toBeNull()
    expect(mockExecFile).toHaveBeenCalledTimes(1) // só a sonda de duração, nunca o corte
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('vídeo acima do limite (3min) é cortado pra 115s, reenviado, e retorna a URL nova', async () => {
    mockExecFile
      .mockRejectedValueOnce(stderrError('Duration: 00:03:00.00, start: 0.000000, bitrate: 128 kb/s'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const { trimVideoForXIfNeeded } = await import('./trim-video-for-x')
    const result = await trimVideoForXIfNeeded('https://video.test/long.mp4', 'item-long')
    expect(result).toBe('https://storage.test/x-trimmed/item.mp4')
    expect(mockExecFile).toHaveBeenCalledTimes(2)
    expect(mockExecFile.mock.calls[1][1]).toEqual(expect.arrayContaining(['-t', '115']))
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('vídeo com exatamente 120s (limite, não acima) NÃO é cortado', async () => {
    mockExecFile.mockRejectedValueOnce(stderrError('Duration: 00:02:00.00, start: 0.000000, bitrate: 128 kb/s'))
    const { trimVideoForXIfNeeded } = await import('./trim-video-for-x')
    const result = await trimVideoForXIfNeeded('https://video.test/exact.mp4', 'item-exact')
    expect(result).toBeNull()
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })

  it('sem "Duration:" no stderr (duração indeterminada) retorna null sem tentar cortar', async () => {
    mockExecFile.mockRejectedValueOnce(stderrError('algo inesperado, sem informação de duração'))
    const { trimVideoForXIfNeeded } = await import('./trim-video-for-x')
    const result = await trimVideoForXIfNeeded('https://video.test/weird.mp4', 'item-weird')
    expect(result).toBeNull()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('falha no download do vídeo retorna null (nunca lança — não pode bloquear a publicação)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    const { trimVideoForXIfNeeded } = await import('./trim-video-for-x')
    const result = await trimVideoForXIfNeeded('https://video.test/missing.mp4', 'item-404')
    expect(result).toBeNull()
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('falha no upload pro storage retorna null (nunca lança)', async () => {
    mockExecFile
      .mockRejectedValueOnce(stderrError('Duration: 00:03:00.00, start: 0.000000, bitrate: 128 kb/s'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    mockUpload.mockResolvedValueOnce({ error: { message: 'bucket cheio' } })
    const { trimVideoForXIfNeeded } = await import('./trim-video-for-x')
    const result = await trimVideoForXIfNeeded('https://video.test/long2.mp4', 'item-long2')
    expect(result).toBeNull()
  })
})
