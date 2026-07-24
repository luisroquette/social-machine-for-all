'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Setting { key: string; value: string; description: string | null }

const FIELDS: Record<string, { label: string; min?: number; max?: number }> = {
  monitor_max_topics: { label: 'Max trending topics por scan', min: 1, max: 20 },
  curator_max_posts_per_topic: { label: 'Max posts curados por topic', min: 1, max: 10 },
  writer_max_items_per_run: { label: 'Max itens do redator por execucao', min: 1, max: 50 },
  reviewer_max_items_per_run: { label: 'Max drafts revisados por execucao', min: 1, max: 50 },
  topic_expiry_hours: { label: 'Expiracao de topics (horas)', min: 1, max: 168 },
  topic_dedup_window_hours: { label: 'Janela de dedup de topics (horas)', min: 1, max: 168 },
  performance_lookback_days: { label: 'Lookback de performance (dias)', min: 1, max: 90 },
  ads_lookback_days: { label: 'Lookback de ads (dias)', min: 1, max: 90 },
}

export default function PipelineSettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const load = useCallback(async () => {
    const res = await fetch('/api/settings')
    const data = await res.json()
    setSettings(data.pipeline ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const update = (key: string, value: string) => setSettings(p => p.map(s => s.key === key ? { ...s, value } : s))

  const save = async () => {
    setSaving(true); setStatus('idle')
    try {
      for (const s of settings) {
        await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'pipeline', key: s.key, value: s.value }) })
      }
      setStatus('saved')
    } catch { setStatus('error') }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pipeline
          {status === 'saved' && <Badge className="bg-green-500">Salvo</Badge>}
          {status === 'error' && <Badge variant="destructive">Erro</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.map(s => {
          const f = FIELDS[s.key] ?? { label: s.key }
          return (
            <div key={s.key} className="grid gap-1.5">
              <Label htmlFor={s.key}>{f.label}</Label>
              <Input id={s.key} type="number" value={s.value} onChange={e => update(s.key, e.target.value)} min={f.min} max={f.max} />
              {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
            </div>
          )
        })}
        {settings.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma config de pipeline encontrada.</p>}
        <Button onClick={save} disabled={saving} className="w-full">{saving ? 'Salvando...' : 'Salvar Pipeline'}</Button>
      </CardContent>
    </Card>
  )
}
