/**
 * REGRESSÃO: curator do brand só roda de segunda a sexta, mas reels precisam
 * publicar todos os dias
 *
 * BUG (reportado em produção):
 * - accountKey: brand
 * - severidade: below_min
 * - detalhe: 0 publicado(s) hoje, mínimo esperado é 1 (meta 2).
 *
 * CAUSA RAIZ:
 * O agente curator do brand tem schedule_cron='0 8 * * 1-5' (segunda a sexta
 * às 8h), mas os reels precisam publicar TODOS OS DIAS para atingir min_reels_per_day=1.
 * Aos sábados e domingos, sem curadoria nova, o pipeline fica sem candidatos e
 * não publica nenhum reel.
 *
 * Os crons reels-prepare-brand e reels-publish rodam às 8h, 12h e 18h todos
 * os dias (schedule="0 8,12,18 * * *"), mas dependem de curated_content criado
 * pelo curator. Sem curadoria aos fins de semana, sem reels.
 *
 * FIX:
 * Mudar schedule_cron do curator de '0 8 * * 1-5' para '0 8 * * *' (todos os dias).
 * Conteúdo sobre EVs, infraestrutura e legislação é notícia 7 dias/semana.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'

describe('REGRESSÃO: curator do brand precisa rodar todos os dias', () => {
  it('migrations_legacy/012_workspace_brand_mob.sql: curator schedule_cron roda 7 dias/semana', () => {
    const sql = fs.readFileSync('supabase/migrations_legacy/012_workspace_brand_mob.sql', 'utf8')

    // Encontra a definição do curator
    const curatorSection = sql.match(/'curator',[\s\S]*?'0 \d+ \* \* ([^']+)'/)?.[1]

    expect(curatorSection).toBeDefined()
    // Deve ser '0 8 * * *' (todos os dias) e NÃO '0 8 * * 1-5' (segunda a sexta)
    expect(curatorSection).not.toMatch(/1-5/)
    expect(sql).toMatch(/'curator',[\s\S]*?'0 8 \* \* \*'/)
  })

  it('reels-prepare-brand roda todos os dias (confirmação de que a expectativa é 7 dias/semana)', () => {
    const vercel = fs.readFileSync('vercel.json', 'utf8')
    const config = JSON.parse(vercel)

    const reelsPreparebrandmob = config.crons.find((c: { path: string }) =>
      c.path === '/api/cron/reels-prepare-brand'
    )

    expect(reelsPreparebrandmob).toBeDefined()
    // Roda às 8h, 12h e 18h TODOS OS DIAS (* * *)
    expect(reelsPreparebrandmob.schedule).toBe('0 8,12,18 * * *')
  })

  it('min_reels_per_day=1 implica expectativa de publicação TODOS OS DIAS', () => {
    const settings = fs.readFileSync('src/lib/settings/load-settings.ts', 'utf8')

    // min_reels_per_day é a expectativa diária, não apenas dias úteis
    expect(settings).toMatch(/min_reels_per_day.*1/)
  })

  it('heartbeat alerta reels_below_min_brand para QUALQUER DIA (não só dias úteis)', () => {
    const heartbeat = fs.readFileSync('src/app/api/cron/heartbeat/route.ts', 'utf8')

    // O heartbeat monitora brand sem exceção de fim de semana
    expect(heartbeat).toMatch(/reelsPublishedTodaybrand/)
    expect(heartbeat).toMatch(/reels_below_min_brand/)

    // E NÃO há nenhum check de "é fim de semana? pular alerta"
    expect(heartbeat).not.toMatch(/weekend|sábado|domingo|saturday|sunday/i)
  })
})
