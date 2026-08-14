import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import './i18n'

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
        <main className="flex h-dvh items-center justify-center bg-background p-6">
          <section className="max-w-md text-center">
            <h1 className="text-lg font-semibold text-foreground">画布暂时无法显示</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">已保护当前浏览器页面，重新加载后可继续使用。</p>
            <button type="button" className="mt-5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90" onClick={() => window.location.reload()}>重新加载</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
)
