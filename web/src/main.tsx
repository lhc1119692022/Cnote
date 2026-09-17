import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { AppDialogHost } from '@/components/ui/app-dialog-host'
import './index.css'
import './i18n'
import { DesktopWindowChrome } from '@/components/layout/DesktopWindowChrome'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('应用渲染失败:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex h-full items-center justify-center bg-background p-6">
          <section className="max-w-md text-center">
            <h1 className="text-lg font-semibold text-foreground">画布暂时无法显示</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">已保护当前浏览器页面，重新加载后可继续使用。</p>
            {import.meta.env.DEV && (
              <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-left text-xs text-destructive">
                {this.state.error.message || this.state.error.name}
                {'\n'}
                {this.state.error.stack || ''}
              </pre>
            )}
            <div className="mt-5 flex items-center justify-center gap-2">
              <button type="button" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90" onClick={() => { if (window.cnoteDesktop?.window) void window.cnoteDesktop.window.reload(); else window.location.reload() }}>重新加载</button>
              {window.cnoteDesktop?.window && <button type="button" className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted" onClick={() => void window.cnoteDesktop?.window.close()}>关闭 Cnote</button>}
            </div>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopWindowChrome>
      <AppErrorBoundary>
        <HashRouter>
          <App />
          <AppDialogHost />
        </HashRouter>
      </AppErrorBoundary>
    </DesktopWindowChrome>
  </React.StrictMode>,
)
