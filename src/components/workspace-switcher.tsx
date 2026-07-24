'use client'

import { useRouter } from 'next/navigation'
import { switchWorkspace } from '@/app/actions/switch-workspace'

type Workspace = { id: string; name: string }

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: Workspace[]
  activeId: string
}) {
  const router = useRouter()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    await switchWorkspace(e.target.value)
    router.refresh()
  }

  return (
    <select
      value={activeId}
      onChange={handleChange}
      className="text-sm border border-border rounded px-2 py-1 bg-background text-foreground"
    >
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  )
}
