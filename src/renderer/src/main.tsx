import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { keepPluginRuntime } from './vendor/keep'
import './styles.css'

// 保留外部插件所需的 react 命名导出(渲染入口启动即执行)
keepPluginRuntime()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
