'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface BrandConfig {
  tone: string
  language: string
  sector: string
  hashtags: string
  rules: string
}

interface WorkspaceData {
  name: string
  description: string
  topic_keywords: string[]
  brand_config: BrandConfig
}

export default function WorkspaceSettingsPage() {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/workspace')
      const json = await res.json()
      setData(json)
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleSave() {
    if (!data) return
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save')
      setStatus('success')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>
  if (!data) return <p className="text-destructive">Erro ao carregar workspace.</p>

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws-name">Nome</Label>
            <Input
              id="ws-name"
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-desc">Descricao</Label>
            <Textarea
              id="ws-desc"
              value={data.description ?? ''}
              onChange={(e) => setData({ ...data, description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-keywords">Palavras-chave (separadas por virgula)</Label>
            <Textarea
              id="ws-keywords"
              value={Array.isArray(data.topic_keywords) ? data.topic_keywords.join(', ') : ''}
              onChange={(e) =>
                setData({
                  ...data,
                  topic_keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                })
              }
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand Config</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bc-tone">Tom de voz</Label>
            <Input
              id="bc-tone"
              value={data.brand_config?.tone ?? ''}
              onChange={(e) =>
                setData({ ...data, brand_config: { ...data.brand_config, tone: e.target.value } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-language">Idioma</Label>
            <Input
              id="bc-language"
              value={data.brand_config?.language ?? ''}
              onChange={(e) =>
                setData({ ...data, brand_config: { ...data.brand_config, language: e.target.value } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-sector">Setor</Label>
            <Input
              id="bc-sector"
              value={data.brand_config?.sector ?? ''}
              onChange={(e) =>
                setData({ ...data, brand_config: { ...data.brand_config, sector: e.target.value } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-hashtags">Hashtags</Label>
            <Input
              id="bc-hashtags"
              value={data.brand_config?.hashtags ?? ''}
              onChange={(e) =>
                setData({ ...data, brand_config: { ...data.brand_config, hashtags: e.target.value } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-rules">Regras</Label>
            <Textarea
              id="bc-rules"
              value={data.brand_config?.rules ?? ''}
              onChange={(e) =>
                setData({ ...data, brand_config: { ...data.brand_config, rules: e.target.value } })
              }
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        {status === 'success' && <Badge variant="default" className="bg-green-600">Salvo com sucesso</Badge>}
        {status === 'error' && <Badge variant="destructive">Erro ao salvar</Badge>}
      </div>
    </div>
  )
}
