/**
 * REGRESSÃO: cleanup-storage deixava metade do bucket 'reels' crescer para sempre.
 *
 * 1. O cron só limpava downloads/ e covers/, ignorando pastas de render.
 * 2. list(folder, { limit: 500 }) sem paginação, ordenado por NOME: com 620
 *    arquivos em downloads/, 120+ ficavam invisíveis para SEMPRE (vídeos de
 *    40+ dias vivos com política de 30).
 * 3. O bucket 'brand-assets' não tinha limpeza nenhuma (backgrounds/ crescendo).
 *
 * Estes testes quebram o build se as pastas sumirem da política ou se a
 * paginação for removida.
 */
import { describe, it, expect } from 'vitest'
import { CLEANUP_TARGETS, PROTECTED_FOLDERS, isExpired, listAllFiles } from './storage-cleanup-policy'

describe('REGRESSÃO: política de limpeza cobre as pastas que crescem', () => {
  const reelsFolders = CLEANUP_TARGETS.filter(t => t.bucket === 'reels').map(t => t.folder)
  const brandFolders = CLEANUP_TARGETS.filter(t => t.bucket === 'brand-assets').map(t => t.folder)

  it('pastas de render do Railway estão na política (eram o buraco de 6.5GB)', () => {
    expect(reelsFolders).toContain('editorial-frame')
    expect(reelsFolders).toContain('brand-frame')
    expect(reelsFolders).toContain('capcut')
  })

  it('capcut/ legado tem retenção 0 — purge total', () => {
    const capcut = CLEANUP_TARGETS.find(t => t.folder === 'capcut')
    expect(capcut?.retentionDays).toBe(0)
  })

  it('bucket brand-assets entrou na política (não tinha limpeza nenhuma)', () => {
    expect(brandFolders).toContain('backgrounds')
    expect(brandFolders).toContain('carousel')
    expect(brandFolders).toContain('posts')
  })

  it('downloads/ mantém 30d — itens reel_ready na fila referenciam esses vídeos', () => {
    const downloads = CLEANUP_TARGETS.find(t => t.bucket === 'reels' && t.folder === 'downloads')
    expect(downloads?.retentionDays).toBe(30)
  })

  it('frames renderizados têm ≥14d — margem p/ claim do BRAND e retries', () => {
    for (const f of ['editorial-frame', 'brand-frame']) {
      const t = CLEANUP_TARGETS.find(x => x.folder === f)
      expect(t!.retentionDays).toBeGreaterThanOrEqual(14)
    }
  })

  it('pastas de marca são protegidas e nunca aparecem na política', () => {
    for (const p of PROTECTED_FOLDERS) {
      expect(CLEANUP_TARGETS.some(t => t.folder === p)).toBe(false)
    }
  })
})

describe('REGRESSÃO: isExpired', () => {
  const now = new Date('2026-07-04T12:00:00Z').getTime()

  it('arquivo de 40 dias com retenção 30 → expirado (caso real que ficava vivo)', () => {
    expect(isExpired('2026-05-25T12:00:00Z', 30, now)).toBe(true)
  })

  it('arquivo de ontem com retenção 30 → mantido', () => {
    expect(isExpired('2026-07-03T12:00:00Z', 30, now)).toBe(false)
  })

  it('retenção 0 → qualquer arquivo com data é expirado (purge do capcut)', () => {
    expect(isExpired('2026-07-04T11:59:00Z', 0, now)).toBe(true)
  })

  it('created_at ausente → NUNCA deleta (fail-safe)', () => {
    expect(isExpired(null, 0, now)).toBe(false)
    expect(isExpired(undefined, 30, now)).toBe(false)
  })
})

describe('REGRESSÃO: paginação do list()', () => {
  it('lê TODAS as páginas — 620 arquivos com pageSize 100 → 7 chamadas, 620 itens', async () => {
    const total = 620
    const files = Array.from({ length: total }, (_, i) => ({ name: `f${i}.mp4`, created_at: '2026-05-01T00:00:00Z' }))
    let calls = 0
    const result = await listAllFiles(async (offset, limit) => {
      calls++
      return files.slice(offset, offset + limit)
    }, 100)
    expect(result).toHaveLength(total)
    expect(calls).toBe(7) // 6 páginas cheias + 1 parcial (20)
  })

  it('pasta vazia → 1 chamada, 0 itens', async () => {
    const result = await listAllFiles(async () => [], 100)
    expect(result).toHaveLength(0)
  })
})
