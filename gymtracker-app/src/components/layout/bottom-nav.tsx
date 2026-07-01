import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Dumbbell, BrainCircuit, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/treino/execucao', icon: Dumbbell, label: 'Treino' },
  { to: '/treinador', icon: BrainCircuit, label: 'Treinador' },
  { to: '/configuracoes', icon: Settings, label: 'Config' },
]

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background pb-safe md:hidden">
      <div className="flex h-16">
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = pathname === to || (to !== '/' && pathname.startsWith(to))
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
