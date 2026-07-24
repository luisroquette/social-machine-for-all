'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Setting { key: string; value: string; description: string | null }

const FIELDS: Record<string, { label: string; type: 'number' | 'text'; min?: number; max?: number }> = {
  tweet_max_length: { label: 'Limite de caracteres para tweets', type: 'number', min: 100, max: 500 },
  max_posts_per_run: { label: 'Max posts publicados por execucao', type: 'number', min: 1, max: 20 },
  target_handle: { label: 'Handle do Twitter (sem @)', type: 'text' },
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const load = useCallback(async () => {
    const res = await fetch('/api/settings')
    const data = await res.json()
    setSettings(data.platform ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const update = (key: string, value: string) => setSettings(p => p.map(s => s.key === key ? { ...s, value } : s))

  const save = async () => {
    setSaving(true); setStatus('idle')
    try {
      for (const s of settings) {
        await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'platform', key: s.key, value: s.value }) })
      }
      setStatus('saved')
    } catch { setStatus('error') }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Plataforma (X/Twitter)
          {status === 'saved' && <Badge className="bg-green-500">Salvo</Badge>}
          {status === 'error' && <Badge variant="destructive">Erro</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.map(s => {
          const f = FIELDS[s.key] ?? { label: s.key, type: 'text' }
          return (
            <div key={s.key} className="grid gap-1.5">
              <Label htmlFor={s.key}>{f.label}</Label>
              <Input id={s.key} type={f.type} value={s.value} onChange={e => update(s.key, e.target.value)} min={f.min} max={f.max} />
              {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
            </div>
          )
        })}
        {settings.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma config de plataforma encontrada.</p>}
        <Button onClick={save} disabled={saving} className="w-full">{saving ? 'Salvando...' : 'Salvar Plataforma'}</Button>
      </CardContent>
    </Card>
  )
}
