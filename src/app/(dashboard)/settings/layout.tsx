import { Separator } from '@/components/ui/separator'
import { SettingsNav } from '@/components/settings-nav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Configuracoes</h2>
      </div>
      <SettingsNav />
      <Separator />
      {children}
    </div>
  )
}
