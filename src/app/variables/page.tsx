'use client'

import { useEffect, useState, useCallback } from 'react'

// ── Schema: todas as variáveis configuráveis com metadata ─────────────────────
const SCHEMA = [
  {
    category: 'Contas & Redes Sociais',
    fields: [
      { key: 'instagram_handle',   dbCat: 'accounts', label: 'Handle do Instagram',        description: 'Handle completo do perfil Instagram (com @)',             type: 'text',   default: '@inteligencia.artificial.brazil' },
      { key: 'own_twitter_handle', dbCat: 'accounts', label: 'Handle próprio no X/Twitter', description: 'Sem @ — usado para filtrar replies do engagement agent',  type: 'text',   default: 'thedoomguy_ai' },
      { key: 'target_handle',      dbCat: 'platform', label: 'Handle monitorado no X',      description: 'Sem @ — handle que o radar monitora para curadoria',      type: 'text',   default: 'example_handle' },
    ],
  },
  {
    category: 'Qualidade & Revisão',
    fields: [
      { key: 'reviewer_approval_threshold', dbCat: 'quality', label: 'Nota mínima de aprovação',   description: 'Nota do revisor (0–10) para aprovar conteúdo',         type: 'number', default: '7' },
      { key: 'quality_gate_pass_score',     dbCat: 'quality', label: 'Nota mínima quality gate',   description: 'Score mínimo (0–10) no quality gate automático',        type: 'number', default: '6' },
      { key: 'quality_gate_max_issues',     dbCat: 'quality', label: 'Máx. issues permitidos',     description: 'Quantidade máxima de issues para passar no quality gate', type: 'number', default: '1' },
      { key: 'dedup_similarity_threshold',  dbCat: 'quality', label: 'Limiar de similaridade',     description: 'Similaridade Jaccard (0–1) para considerar duplicata',  type: 'number', default: '0.5' },
      { key: 'dedup_window_hours',          dbCat: 'quality', label: 'Janela de deduplicação (h)',  description: 'Horas para considerar conteúdo como duplicata',         type: 'number', default: '48' },
    ],
  },
  {
    category: 'Formato de Conteúdo',
    fields: [
      { key: 'tweet_max_length', dbCat: 'platform', label: 'Tamanho máximo do tweet',  description: 'Caracteres máximos por tweet (padrão X: 280)',   type: 'number', default: '280' },
      { key: 'max_hashtags',     dbCat: 'quality',  label: 'Máx. hashtags por post',   description: 'Limite de hashtags inseridos pelo writer',      type: 'number', default: '2' },
      { key: 'max_emojis',       dbCat: 'quality',  label: 'Máx. emojis por post',     description: 'Limite de emojis inseridos pelo writer',        type: 'number', default: '1' },
    ],
  },
  {
    category: 'Pipeline',
    fields: [
      { key: 'max_posts_per_run',          dbCat: 'platform', label: 'Posts por execução',             description: 'Máximo de posts publicados por run do publisher',         type: 'number', default: '1' },
      { key: 'writer_max_items_per_run',   dbCat: 'pipeline', label: 'Itens por run (writer)',          description: 'Máximo de itens processados pelo writer por execução',    type: 'number', default: '10' },
      { key: 'reviewer_max_items_per_run', dbCat: 'pipeline', label: 'Itens por run (revisor)',         description: 'Máximo de itens revisados por execução',                 type: 'number', default: '10' },
      { key: 'monitor_max_topics',         dbCat: 'pipeline', label: 'Máx. tópicos monitorados',       description: 'Tópicos simultâneos no monitor de tendências',            type: 'number', default: '6' },
      { key: 'curator_max_posts_per_topic',dbCat: 'pipeline', label: 'Posts por tópico (curador)',      description: 'Máximo de posts coletados por tópico por run',           type: 'number', default: '4' },
      { key: 'topic_expiry_hours',         dbCat: 'pipeline', label: 'Expiração de tópicos (h)',        description: 'Horas até um tópico ser descartado do monitor',          type: 'number', default: '24' },
      { key: 'topic_dedup_window_hours',   dbCat: 'pipeline', label: 'Janela dedup de tópicos (h)',     description: 'Janela de horas para deduplicar tópicos similares',      type: 'number', default: '24' },
      { key: 'performance_lookback_days',  dbCat: 'pipeline', label: 'Janela de performance (dias)',    description: 'Dias de histórico para avaliar performance de conteúdo', type: 'number', default: '7' },
      { key: 'ads_lookback_days',          dbCat: 'pipeline', label: 'Janela de anúncios (dias)',       description: 'Dias de histórico para o ads strategist',                type: 'number', default: '7' },
    ],
  },
  {
    category: 'Reels',
    fields: [
      { key: 'reels_relevance_threshold', dbCat: 'reels', label: 'Relevância mínima para Reels', description: 'Score mínimo de relevância para selecionar conteúdo como Reel', type: 'number', default: '25' },
      { key: 'reels_freshness_hours',     dbCat: 'reels', label: 'Janela de frescor (h)',         description: 'Máximo de horas de idade do conteúdo para virar Reel',          type: 'number', default: '48' },
    ],
  },
  {
    category: 'Curadoria & Filtros',
    fields: [
      { key: 'curator_banned_keywords', dbCat: 'curator', label: 'Palavras banidas', description: 'Separadas por vírgula. Conteúdo com esses termos é automaticamente rejeitado', type: 'textarea', default: 'crypto,defi,blockchain,token,nft,trading,forex' },
    ],
  },
]

type FieldState = Record<string, { value: string; saved: boolean; saving: boolean; error: string | null }>

export default function VariablesPage() {
  const [values, setValues] = useState<FieldState>({})
  const [loading, setLoading] = useState(true)

  // Load all settings from DB
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((grouped: Record<string, Array<{ key: string; value: string }>>) => {
        // Flatten DB values
        const dbMap: Record<string, string> = {}
        for (const fields of Object.values(grouped)) {
          for (const f of fields) dbMap[f.key] = f.value
        }
        // Merge with schema defaults
        const initial: FieldState = {}
        for (const section of SCHEMA) {
          for (const field of section.fields) {
            initial[field.key] = {
              value: dbMap[field.key] ?? field.default,
              saved: false,
              saving: false,
              error: null,
            }
          }
        }
        setValues(initial)
        setLoading(false)
      })
      .catch(() => {
        // Fallback to defaults
        const initial: FieldState = {}
        for (const section of SCHEMA) {
          for (const field of section.fields) {
            initial[field.key] = { value: field.default, saved: false, saving: false, error: null }
          }
        }
        setValues(initial)
        setLoading(false)
      })
  }, [])

  const handleChange = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: { ...prev[key], value, saved: false, error: null } }))
  }, [])

  const handleSave = useCallback(async (key: string, dbCat: string) => {
    setValues(prev => ({ ...prev, [key]: { ...prev[key], saving: true, error: null } }))
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: dbCat, key, value: values[key]?.value ?? '' }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      setValues(prev => ({ ...prev, [key]: { ...prev[key], saving: false, saved: true } }))
      setTimeout(() => setValues(prev => ({ ...prev, [key]: { ...prev[key], saved: false } })), 2000)
    } catch {
      setValues(prev => ({ ...prev, [key]: { ...prev[key], saving: false, error: 'Falha ao salvar' } }))
    }
  }, [values])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <span className="text-zinc-400 text-sm">Carregando variáveis...</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Admin</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Variáveis do Sistema</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Todas as configurações operacionais da Social Machine. Alterações entram em vigor na próxima execução.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {SCHEMA.map(section => (
            <div key={section.category}>
              <h2 className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-4 pb-2 border-b border-zinc-800">
                {section.category}
              </h2>
              <div className="space-y-4">
                {section.fields.map(field => {
                  const state = values[field.key]
                  return (
                    <div key={field.key} className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <label className="text-sm font-medium text-zinc-100">{field.label}</label>
                            <span className="text-xs font-mono text-zinc-600">{field.key}</span>
                          </div>
                          <p className="text-xs text-zinc-500 mb-3">{field.description}</p>
                          {field.type === 'textarea' ? (
                            <textarea
                              value={state?.value ?? field.default}
                              onChange={e => handleChange(field.key, e.target.value)}
                              rows={3}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
                            />
                          ) : (
                            <input
                              type={field.type}
                              value={state?.value ?? field.default}
                              onChange={e => handleChange(field.key, e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                            />
                          )}
                          {state?.error && (
                            <p className="text-xs text-red-400 mt-1">{state.error}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleSave(field.key, field.dbCat)}
                          disabled={state?.saving}
                          className={`mt-7 shrink-0 px-4 py-2 rounded-md text-xs font-medium transition-all ${
                            state?.saved
                              ? 'bg-green-900 text-green-400 border border-green-800'
                              : state?.saving
                              ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-wait'
                              : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500 hover:text-white'
                          }`}
                        >
                          {state?.saved ? '✓ Salvo' : state?.saving ? '...' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-600">
          <span>Social Machine V3.1 — /variables</span>
          <span>Não indexado · Acesso direto por URL</span>
        </div>
      </div>
    </div>
  )
}
