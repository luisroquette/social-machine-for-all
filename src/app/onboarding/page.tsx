'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function OnboardingPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [keywords, setKeywords] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const response = await fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, topicKeywords: keywords.split(',') }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setError(body.error || 'Could not create workspace.')
      setLoading(false)
      return
    }
    window.location.assign('/')
  }

  return <main className="min-h-screen flex items-center justify-center p-6"><Card className="w-full max-w-lg"><CardHeader><CardTitle>Set up Social Machine</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="name">Brand or workspace name</Label><Input id="name" value={name} onChange={e => setName(e.target.value)} required /></div><div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="keywords">Topics (comma-separated)</Label><Input id="keywords" value={keywords} onChange={e => setKeywords(e.target.value)} /></div>{error && <p className="text-sm text-red-500">{error}</p>}<Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create workspace'}</Button></form></CardContent></Card></main>
}
