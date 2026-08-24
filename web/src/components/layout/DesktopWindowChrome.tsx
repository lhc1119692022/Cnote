import type { ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface DesktopWindowChromeProps {
  children: ReactNode
}

export function DesktopWindowChrome({ children }: DesktopWindowChromeProps) {
  const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!desktop?.window) return

    let active = true
    void desktop.window.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })
    return desktop.window.onStateChanged((state) => setMaximized(state.maximized))
  }, [desktop])

  if (!desktop?.window) return <>{children}</>

  const toggleMaximize = async () => {
    setMaximized(await desktop.window.toggleMaximize())
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <header
        className="cnote-window-titlebar"
        data-testid="cnote-window-titlebar"
        onDoubleClick={() => void toggleMaximize()}
        aria-label="Cnote 标题栏"
      >
        <div className="cnote-window-drag-region" aria-hidden="true" />
        <div className="cnote-window-controls" aria-label="窗口控制">
          <button
            type="button"
            className="cnote-window-control"
            data-testid="cnote-window-minimize"
            aria-label="最小化 Cnote"
            onClick={() => void desktop.window.minimize()}
          >
            <Minus aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="cnote-window-control"
            data-testid="cnote-window-maximize"
            aria-label={maximized ? '还原 Cnote' : '最大化 Cnote'}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? (
              <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
            ) : (
              <Square aria-hidden="true" size={14} strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            className="cnote-window-control cnote-window-control-close"
            data-testid="cnote-window-close"
            aria-label="关闭 Cnote"
            onClick={() => void desktop.window.close()}
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <div className="cnote-window-content min-h-0 flex-1">{children}</div>
    </div>
  )
}
