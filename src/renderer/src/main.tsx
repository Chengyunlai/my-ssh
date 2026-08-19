import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { keepPluginRuntime } from './vendor/keep'
import './styles.css'

// 保留外部插件所需的 react 命名导出(渲染入口启动即执行)
keepPluginRuntime()

// 标记平台,供 CSS 做原生窗口适配(如 macOS 红绿灯左侧留白)
document.documentElement.dataset.platform = window.ssh.platform

// 渲染层未捕获错误/未处理 Promise 拒绝:上报主进程日志,便于排查
window.addEventListener('error', (e) => {
  window.ssh.logError(
    'renderer',
    e.message || 'script error',
    e.error instanceof Error ? (e.error.stack ?? e.error.message) : `${e.filename}:${e.lineno}`
  )
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  window.ssh.logError(
    'renderer',
    'unhandledrejection',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  )
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
