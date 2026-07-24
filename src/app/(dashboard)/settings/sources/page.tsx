'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ── Types ──

interface MonitorSource {
  id: string
  handle: string
  platform: string
  active: boolean
  created_at: string
}

interface EngagementProfile {
  id: string
  handle: string
  platform: string
  active: boolean
  created_at: string | null
  config: {
    max_daily_interactions?: number
  } | null
}

interface TrendingConfig {
  woeid_list: string
  trending_filter_keywords: string
}

interface TrendVideoConfig {
  trend_video_enabled: boolean
  trend_video_sources: string
  trend_video_country_code: string
  trend_video_max_topics_per_run: string
  trend_video_max_jobs_per_day: string
  trend_video_shots_per_video: string
  trend_video_generation_mode: string
  trend_video_blocked_keywords: string
  trend_video_allowed_categories: string
  trend_video_required_keywords: string
  trend_video_style_rotation: string
  trend_video_default_cta: string
  trend_video_default_duration_sec: string
  trend_video_image_provider_chain: string
  trend_video_higgsfield_model_default: string
  trend_video_higgsfield_text_model_default: string
}

// ── Component ──

export default function SourcesPage() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="keywords">
      <TabsList>
        <TabsTrigger value="keywords">Keywords</TabsTrigger>
        <TabsTrigger value="profiles">Monitored Profiles</TabsTrigger>
        <TabsTrigger value="engagement">Engagement Profiles</TabsTrigger>
        <TabsTrigger value="trending">Trending Config</TabsTrigger>
        <TabsTrigger value="trend-video">Trend Video</TabsTrigger>
      </TabsList>

        <TabsContent value="keywords" className="mt-6">
          <KeywordsTab />
        </TabsContent>

        <TabsContent value="profiles" className="mt-6">
          <ProfilesTab />
        </TabsContent>

        <TabsContent value="engagement" className="mt-6">
          <EngagementProfilesTab />
        </TabsContent>

        <TabsContent value="trending" className="mt-6">
          <TrendingTab />
        </TabsContent>

        <TabsContent value="trend-video" className="mt-6">
          <TrendVideoTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Tab 1: Keywords ──

function KeywordsTab() {
  const [keywords, setKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const fetchKeywords = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/workspace')
      const json = await res.json()
      setKeywords(Array.isArray(json.topic_keywords) ? json.topic_keywords : [])
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeywords()
  }, [fetchKeywords])

  function updateKeyword(index: number, value: string) {
    const updated = [...keywords]
    updated[index] = value
    setKeywords(updated)
  }

  function removeKeyword(index: number) {
    setKeywords(keywords.filter((_, i) => i !== index))
  }

  function addKeyword() {
    setKeywords([...keywords, ''])
  }

  async function handleSave() {
    setSaving(true)
    setStatus('idle')
    try {
      const cleaned = keywords.map((k) => k.trim()).filter(Boolean)
      const res = await fetch('/api/settings/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_keywords: cleaned }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setKeywords(cleaned)
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Keywords</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Palavras-chave usadas pelo agente Monitor para buscar conteudo relevante.
        </p>

        <div className="space-y-2">
          {keywords.map((keyword, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={keyword}
                onChange={(e) => updateKeyword(index, e.target.value)}
                placeholder="Ex: AI agents"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeKeyword(index)}
                className="text-destructive shrink-0"
              >
                Remover
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addKeyword}>
          + Adicionar keyword
        </Button>

        <div className="flex items-center gap-4 pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Keywords'}
          </Button>
          {status === 'success' && (
            <Badge variant="default" className="bg-green-600">
              Salvo com sucesso
            </Badge>
          )}
          {status === 'error' && <Badge variant="destructive">Erro ao salvar</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Tab 2: Monitored Profiles ──

function ProfilesTab() {
  const [sources, setSources] = useState<MonitorSource[]>([])
  const [newHandle, setNewHandle] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/sources')
      const json = await res.json()
      setSources(Array.isArray(json) ? json : [])
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  async function addProfile() {
    if (!newHandle.trim()) return
    setAdding(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: newHandle.trim() }),
      })
      if (!res.ok) throw new Error('Failed to add')
      const created = await res.json()
      setSources([created, ...sources])
      setNewHandle('')
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      setAdding(false)
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  async function toggleActive(id: string, active: boolean) {
    try {
      const res = await fetch('/api/settings/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
      })
      if (!res.ok) throw new Error('Failed to toggle')
      setSources(sources.map((s) => (s.id === id ? { ...s, active } : s)))
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  async function deleteSource(id: string) {
    try {
      const res = await fetch(`/api/settings/sources?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setSources(sources.filter((s) => s.id !== id))
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitored Profiles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Perfis do Twitter/X monitorados para curadoria de conteudo.
        </p>

        <div className="flex items-center gap-2">
          <Input
            value={newHandle}
            onChange={(e) => setNewHandle(e.target.value)}
            placeholder="@handle"
            onKeyDown={(e) => e.key === 'Enter' && addProfile()}
          />
          <Button onClick={addProfile} disabled={adding} className="shrink-0">
            {adding ? 'Adicionando...' : 'Adicionar'}
          </Button>
        </div>

        {status === 'success' && (
          <Badge variant="default" className="bg-green-600">
            Perfil adicionado
          </Badge>
        )}
        {status === 'error' && <Badge variant="destructive">Erro na operacao</Badge>}

        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum perfil monitorado ainda.</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Handle</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-right p-3 font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} className="border-b last:border-0">
                    <td className="p-3 font-mono">@{source.handle}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={source.active}
                          onCheckedChange={(checked) => toggleActive(source.id, checked)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {source.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSource(source.id)}
                        className="text-destructive"
                      >
                        Remover
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EngagementProfilesTab() {
  const [profiles, setProfiles] = useState<EngagementProfile[]>([])
  const [newHandle, setNewHandle] = useState('')
  const [newMaxDaily, setNewMaxDaily] = useState('3')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('Erro na operacao')

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/engagement-profiles')
      const json = await res.json()
      setProfiles(Array.isArray(json) ? json : [])
    } catch {
      setStatus('error')
      setStatusMessage('Erro ao carregar perfis de engajamento')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  async function addProfile() {
    if (!newHandle.trim()) return
    setAdding(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/engagement-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: newHandle.trim(),
          platform: 'x',
          max_daily_interactions: Number(newMaxDaily) || 3,
        }),
      })

      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to add')

      setProfiles([payload, ...profiles])
      setNewHandle('')
      setNewMaxDaily('3')
      setStatus('success')
      setStatusMessage('Perfil de engajamento adicionado')
    } catch (error) {
      setStatus('error')
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao adicionar perfil')
    } finally {
      setAdding(false)
      setTimeout(() => setStatus('idle'), 3500)
    }
  }

  async function toggleActive(profile: EngagementProfile, active: boolean) {
    try {
      const res = await fetch('/api/settings/engagement-profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: profile.id,
          active,
          max_daily_interactions: profile.config?.max_daily_interactions ?? 3,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to toggle')
      setProfiles(profiles.map((item) => (item.id === profile.id ? { ...item, active } : item)))
    } catch (error) {
      setStatus('error')
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao atualizar perfil')
      setTimeout(() => setStatus('idle'), 3500)
    }
  }

  async function updateMaxDaily(profile: EngagementProfile, value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 1) return

    try {
      const res = await fetch('/api/settings/engagement-profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: profile.id,
          active: profile.active,
          max_daily_interactions: parsed,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to update')
      setProfiles(profiles.map((item) => (
        item.id === profile.id
          ? { ...item, config: { ...(item.config ?? {}), max_daily_interactions: parsed } }
          : item
      )))
    } catch (error) {
      setStatus('error')
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao atualizar limite')
      setTimeout(() => setStatus('idle'), 3500)
    }
  }

  async function deleteProfile(id: string) {
    try {
      const res = await fetch(`/api/settings/engagement-profiles?id=${id}`, { method: 'DELETE' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to delete')
      setProfiles(profiles.filter((item) => item.id !== id))
    } catch (error) {
      setStatus('error')
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao remover perfil')
      setTimeout(() => setStatus('idle'), 3500)
    }
  }

  async function reconcileSameOwnerProfiles() {
    setReconciling(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/engagement-profiles/reconcile', {
        method: 'POST',
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to reconcile')

      await fetchProfiles()
      setStatus('success')
      setStatusMessage(
        payload.deactivatedCount > 0
          ? `${payload.deactivatedCount} perfil(is) same-owner desativado(s)`
          : 'Nenhum perfil same-owner ativo encontrado'
      )
    } catch (error) {
      setStatus('error')
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao reconciliar perfis')
    } finally {
      setReconciling(false)
      setTimeout(() => setStatus('idle'), 3500)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engagement Profiles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Perfis externos elegíveis para o agente de engajamento. Perfis same-owner são barrados na API.
        </p>

        <div className="flex justify-end">
          <Button variant="outline" onClick={reconcileSameOwnerProfiles} disabled={reconciling}>
            {reconciling ? 'Reconciliando...' : 'Desativar Same-Owner Existentes'}
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
          <Input
            value={newHandle}
            onChange={(e) => setNewHandle(e.target.value)}
            placeholder="@handle_externo"
            onKeyDown={(e) => e.key === 'Enter' && addProfile()}
          />
          <Input
            value={newMaxDaily}
            onChange={(e) => setNewMaxDaily(e.target.value)}
            inputMode="numeric"
            placeholder="3"
          />
          <Button onClick={addProfile} disabled={adding}>
            {adding ? 'Adicionando...' : 'Adicionar'}
          </Button>
        </div>

        {status === 'success' && (
          <Badge variant="default" className="bg-green-600">
            {statusMessage}
          </Badge>
        )}
        {status === 'error' && <Badge variant="destructive">{statusMessage}</Badge>}

        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhum perfil de engajamento ainda.</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Handle</th>
                  <th className="text-left p-3 font-medium">Max/dia</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-right p-3 font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-b last:border-0">
                    <td className="p-3 font-mono">@{profile.handle}</td>
                    <td className="p-3">
                      <Input
                        className="max-w-20"
                        defaultValue={String(profile.config?.max_daily_interactions ?? 3)}
                        inputMode="numeric"
                        onBlur={(e) => updateMaxDaily(profile, e.target.value)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={profile.active}
                          onCheckedChange={(checked) => toggleActive(profile, checked)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {profile.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteProfile(profile.id)}
                        className="text-destructive"
                      >
                        Remover
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Tab 4: Trending Config ──

function TrendingTab() {
  const [config, setConfig] = useState<TrendingConfig>({
    woeid_list: '1,23424768',
    trending_filter_keywords: 'AI,GPT,Claude,LLM,OpenAI',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      const json = await res.json()
      const trending = json.trending ?? []
      const woeid = trending.find((s: { key: string }) => s.key === 'woeid_list')
      const filterKw = trending.find((s: { key: string }) => s.key === 'trending_filter_keywords')
      setConfig({
        woeid_list: woeid?.value ?? '1,23424768',
        trending_filter_keywords: filterKw?.value ?? 'AI,GPT,Claude,LLM,OpenAI',
      })
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  async function handleSave() {
    setSaving(true)
    setStatus('idle')
    try {
      const updates = [
        { category: 'trending', key: 'woeid_list', value: config.woeid_list },
        { category: 'trending', key: 'trending_filter_keywords', value: config.trending_filter_keywords },
      ]
      for (const u of updates) {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(u),
        })
        if (!res.ok) throw new Error('Failed to save')
      }
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trending Config</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="woeid">WOEIDs (separados por virgula)</Label>
          <Input
            id="woeid"
            value={config.woeid_list}
            onChange={(e) => setConfig({ ...config, woeid_list: e.target.value })}
            placeholder="1,23424768"
          />
          <p className="text-xs text-muted-foreground">
            1=Worldwide, 23424768=Brazil, 455827=Sao Paulo
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-kw">Filter Keywords (separadas por virgula)</Label>
          <Input
            id="filter-kw"
            value={config.trending_filter_keywords}
            onChange={(e) => setConfig({ ...config, trending_filter_keywords: e.target.value })}
            placeholder="AI,GPT,Claude,LLM,OpenAI"
          />
          <p className="text-xs text-muted-foreground">
            Somente trends que contenham essas palavras serao capturadas.
          </p>
        </div>

        <div className="flex items-center gap-4 pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Trending Config'}
          </Button>
          {status === 'success' && (
            <Badge variant="default" className="bg-green-600">
              Salvo com sucesso
            </Badge>
          )}
          {status === 'error' && <Badge variant="destructive">Erro ao salvar</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}

function TrendVideoTab() {
  const [config, setConfig] = useState<TrendVideoConfig>({
    trend_video_enabled: false,
    trend_video_sources: 'google_trends,x_trending',
    trend_video_country_code: 'BR',
    trend_video_max_topics_per_run: '6',
    trend_video_max_jobs_per_day: '1',
    trend_video_shots_per_video: '5',
    trend_video_generation_mode: 'hybrid',
    trend_video_blocked_keywords: 'racismo,morte,morreu,assassinato,briga,agressao,guerra,partido,eleicao,lula,bolsonaro',
    trend_video_allowed_categories: 'technology',
    trend_video_required_keywords: 'gpt,chatgpt,openai,claude,anthropic,gemini,google ai,deepseek,llm,meta ai,llama,copilot,midjourney,sora,runway,higgsfield,perplexity,grok,inteligencia artificial,artificial intelligence',
    trend_video_style_rotation: 'ultrarealista,anime,abstrato-cinematic',
    trend_video_default_cta: 'Voce pode criar videos virais como esse usando o Claude. Comente "PROMPT".',
    trend_video_default_duration_sec: '3',
    trend_video_image_provider_chain: 'gemini,openai',
    trend_video_higgsfield_model_default: 'dop-preview',
    trend_video_higgsfield_text_model_default: 'seedance-2.0',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      const json = await res.json()
      const trendVideo = json.trend_video ?? []
      const get = (key: string, fallback: string) => trendVideo.find((s: { key: string }) => s.key === key)?.value ?? fallback
      setConfig({
        trend_video_enabled: get('trend_video_enabled', 'false') === 'true',
        trend_video_sources: get('trend_video_sources', 'google_trends,x_trending'),
        trend_video_country_code: get('trend_video_country_code', 'BR'),
        trend_video_max_topics_per_run: get('trend_video_max_topics_per_run', '6'),
        trend_video_max_jobs_per_day: get('trend_video_max_jobs_per_day', '1'),
        trend_video_shots_per_video: get('trend_video_shots_per_video', '5'),
        trend_video_generation_mode: get('trend_video_generation_mode', 'hybrid'),
        trend_video_blocked_keywords: get('trend_video_blocked_keywords', 'racismo,morte,morreu,assassinato,briga,agressao,guerra,partido,eleicao,lula,bolsonaro'),
        trend_video_allowed_categories: get('trend_video_allowed_categories', 'technology'),
        trend_video_required_keywords: get('trend_video_required_keywords', 'gpt,chatgpt,openai,claude,anthropic,gemini,google ai,deepseek,llm,meta ai,llama,copilot,midjourney,sora,runway,higgsfield,perplexity,grok,inteligencia artificial,artificial intelligence'),
        trend_video_style_rotation: get('trend_video_style_rotation', 'ultrarealista,anime,abstrato-cinematic'),
        trend_video_default_cta: get('trend_video_default_cta', 'Voce pode criar videos virais como esse usando o Claude. Comente "PROMPT".'),
        trend_video_default_duration_sec: get('trend_video_default_duration_sec', '3'),
        trend_video_image_provider_chain: get('trend_video_image_provider_chain', 'gemini,openai'),
        trend_video_higgsfield_model_default: get('trend_video_higgsfield_model_default', 'dop-preview'),
        trend_video_higgsfield_text_model_default: get('trend_video_higgsfield_text_model_default', 'seedance-2.0'),
      })
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  async function handleSave() {
    setSaving(true)
    setStatus('idle')
    try {
      const updates = [
        { category: 'trend_video', key: 'trend_video_enabled', value: String(config.trend_video_enabled) },
        { category: 'trend_video', key: 'trend_video_sources', value: config.trend_video_sources },
        { category: 'trend_video', key: 'trend_video_country_code', value: config.trend_video_country_code },
        { category: 'trend_video', key: 'trend_video_max_topics_per_run', value: config.trend_video_max_topics_per_run },
        { category: 'trend_video', key: 'trend_video_max_jobs_per_day', value: config.trend_video_max_jobs_per_day },
        { category: 'trend_video', key: 'trend_video_shots_per_video', value: config.trend_video_shots_per_video },
        { category: 'trend_video', key: 'trend_video_generation_mode', value: config.trend_video_generation_mode },
        { category: 'trend_video', key: 'trend_video_blocked_keywords', value: config.trend_video_blocked_keywords },
        { category: 'trend_video', key: 'trend_video_allowed_categories', value: config.trend_video_allowed_categories },
        { category: 'trend_video', key: 'trend_video_required_keywords', value: config.trend_video_required_keywords },
        { category: 'trend_video', key: 'trend_video_style_rotation', value: config.trend_video_style_rotation },
        { category: 'trend_video', key: 'trend_video_default_cta', value: config.trend_video_default_cta },
        { category: 'trend_video', key: 'trend_video_default_duration_sec', value: config.trend_video_default_duration_sec },
        { category: 'trend_video', key: 'trend_video_image_provider_chain', value: config.trend_video_image_provider_chain },
        { category: 'trend_video', key: 'trend_video_higgsfield_model_default', value: config.trend_video_higgsfield_model_default },
        { category: 'trend_video', key: 'trend_video_higgsfield_text_model_default', value: config.trend_video_higgsfield_text_model_default },
      ]
      for (const update of updates) {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
        })
        if (!res.ok) throw new Error('Failed to save')
      }
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trend Video</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1">
            <p className="font-medium">Ativar pipeline de trend video</p>
            <p className="text-sm text-muted-foreground">
              Fluxo novo: tema em alta no Brasil → capa separada + video principal.
            </p>
          </div>
          <Switch
            checked={config.trend_video_enabled}
            onCheckedChange={(checked) => setConfig({ ...config, trend_video_enabled: checked })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tv-sources">Sources</Label>
            <Input id="tv-sources" value={config.trend_video_sources} onChange={(e) => setConfig({ ...config, trend_video_sources: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tv-country">Country Code</Label>
            <Input id="tv-country" value={config.trend_video_country_code} onChange={(e) => setConfig({ ...config, trend_video_country_code: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tv-topics">Max Topics por Run</Label>
            <Input id="tv-topics" value={config.trend_video_max_topics_per_run} onChange={(e) => setConfig({ ...config, trend_video_max_topics_per_run: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tv-jobs">Max Jobs por Dia</Label>
            <Input id="tv-jobs" value={config.trend_video_max_jobs_per_day} onChange={(e) => setConfig({ ...config, trend_video_max_jobs_per_day: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tv-shots">Shots por Video</Label>
            <Input id="tv-shots" value={config.trend_video_shots_per_video} onChange={(e) => setConfig({ ...config, trend_video_shots_per_video: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tv-shot-duration">Duracao por Shot (s)</Label>
            <Input id="tv-shot-duration" value={config.trend_video_default_duration_sec} onChange={(e) => setConfig({ ...config, trend_video_default_duration_sec: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tv-generation-mode">Modo de Geracao</Label>
            <Input id="tv-generation-mode" value={config.trend_video_generation_mode} onChange={(e) => setConfig({ ...config, trend_video_generation_mode: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-style">Rotacao de Estilos</Label>
            <Input id="tv-style" value={config.trend_video_style_rotation} onChange={(e) => setConfig({ ...config, trend_video_style_rotation: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-blocked">Blocked Keywords</Label>
            <Input id="tv-blocked" value={config.trend_video_blocked_keywords} onChange={(e) => setConfig({ ...config, trend_video_blocked_keywords: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-allowed">Allowed Categories</Label>
            <Input id="tv-allowed" value={config.trend_video_allowed_categories} onChange={(e) => setConfig({ ...config, trend_video_allowed_categories: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-required">Required Keywords</Label>
            <Input id="tv-required" value={config.trend_video_required_keywords} onChange={(e) => setConfig({ ...config, trend_video_required_keywords: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-cta">CTA Padrao</Label>
            <Input id="tv-cta" value={config.trend_video_default_cta} onChange={(e) => setConfig({ ...config, trend_video_default_cta: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-image-chain">Fallbacks de Imagem</Label>
            <Input id="tv-image-chain" value={config.trend_video_image_provider_chain} onChange={(e) => setConfig({ ...config, trend_video_image_provider_chain: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-model">Modelo Higgsfield Image-to-Video</Label>
            <Input id="tv-model" value={config.trend_video_higgsfield_model_default} onChange={(e) => setConfig({ ...config, trend_video_higgsfield_model_default: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tv-text-model">Modelo Higgsfield Prompt-Video</Label>
            <Input id="tv-text-model" value={config.trend_video_higgsfield_text_model_default} onChange={(e) => setConfig({ ...config, trend_video_higgsfield_text_model_default: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Trend Video'}
          </Button>
          {status === 'success' && (
            <Badge variant="default" className="bg-green-600">
              Salvo com sucesso
            </Badge>
          )}
          {status === 'error' && <Badge variant="destructive">Erro ao salvar</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}
