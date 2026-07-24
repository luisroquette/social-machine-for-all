'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/settings',          label: 'Workspace' },
  { href: '/settings/agents',   label: 'Agentes' },
  { href: '/settings/quality',  label: 'Qualidade' },
  { href: '/settings/pipeline', label: 'Pipeline' },
  { href: '/settings/platform', label: 'Plataforma' },
  { href: '/settings/sources',  label: 'Sources' },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-2 text-sm">
      {LINKS.map(({ href, label }) => {
        const isActive = href === '/settings'
          ? pathname === '/settings'
          : pathname.startsWith(href)

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'px-3 py-1.5 rounded-md transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
