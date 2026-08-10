import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Archive,
  FileStack,
  FolderKanban,
  Github,
  LayoutDashboard,
  Moon,
  Settings,
  Sun,
} from 'lucide-react'
import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

const navigation = [
  { to: '/dashboard', label: '控制台', icon: LayoutDashboard },
  { to: '/sources', label: '内容', icon: FileStack },
  { to: '/templates', label: '模板', icon: FolderKanban },
  { to: '/outputs', label: '抽屉', icon: Archive },
]

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="flex h-screen min-w-0 bg-background p-2.5 gap-2.5">
      <aside className="w-[196px] shrink-0">
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_8px_28px_rgba(15,23,42,0.08)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.3)]">
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
            <img src="/icon.svg" alt="Cnote" className="h-7 w-7" />
            <span className="text-sm font-semibold text-foreground">Cnote</span>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-2">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors',
                    isActive
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  )
                }
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                <span>{label}</span>
              </NavLink>
            ))}
            <a
              href="https://github.com/lhc1119692022/Cnote/issues/new"
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <Github className="h-4 w-4" strokeWidth={2} />
              <span>Issue</span>
            </a>
          </nav>

          <div className="space-y-1 border-t border-border p-2">
            <NavLink
              to="/settings/api-keys"
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors',
                  isActive
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )
              }
            >
              <Settings className="h-4 w-4" strokeWidth={2} />
              <span>API 密钥</span>
            </NavLink>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={2} />
              )}
              <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
        {children}
      </div>
    </div>
  )
}