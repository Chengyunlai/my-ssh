import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { scheduleTerminalRefit } from './terminal-layout'

interface Props {
  sessionId: string
  shellId: string
  active?: boolean
}

interface FrameScheduler {
  schedule: (callback: () => void) => number
  cancel: (id: number) => void
}

export default function TerminalView({ sessionId, shellId, active = true }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const refitRef = useRef<((force?: boolean) => void) | null>(null)

  useEffect(() => {
    // 终端配色跟随设计 Token(:root CSS 变量),避免两处维护
    const cs = getComputedStyle(document.documentElement)
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
      scrollback: 5000,
      theme: {
        background: cs.getPropertyValue('--terminal-bg').trim() || '#202329',
        foreground: cs.getPropertyValue('--text').trim() || '#f2f2f4',
        cursor: cs.getPropertyValue('--warn').trim() || '#ffd60a'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)

    term.open(containerRef.current!)
    // 测试钩子:按 会话+shell 注册实例,供自动化测试读取缓冲文本
    // (WebGL 渲染器文字画在 canvas,DOM innerText 读不到)
    const termKey = `${sessionId}\u0000${shellId}`
    const reg = (window as unknown as { __xterms?: Record<string, Terminal> }).__xterms ?? {}
    reg[termKey] = term
    ;(window as unknown as { __xterms?: Record<string, Terminal> }).__xterms = reg
    // WebGL 渲染器:大流量/TUI 全屏重绘性能远优于默认 DOM 渲染器;
    // 上下文创建失败(无 GPU/驱动黑名单)时静默回退 DOM 渲染
    let webgl: WebglAddon | undefined
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl?.dispose()
        webgl = undefined
      })
      term.loadAddon(webgl)
    } catch {
      webgl = undefined
    }

    const sendResize = (force = false): void => {
      const el = containerRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      fit.fit()
      const size = { cols: term.cols, rows: term.rows }
      const prev = sizeRef.current
      // 尺寸未变时直接返回:ResizeObserver 在拖拽窗口时高频触发,
      // 无条件 refresh(0, rows-1) 会造成全视口重绘风暴
      if (!force && prev && prev.cols === size.cols && prev.rows === size.rows) return
      sizeRef.current = size
      term.refresh(0, term.rows - 1)
      window.ssh.resize(sessionId, shellId, size.cols, size.rows)
    }
    refitRef.current = sendResize
    sendResize(true)
    const observer = new ResizeObserver(() => sendResize())
    observer.observe(containerRef.current!)

    const inputSub = term.onData((data) => window.ssh.sendData(sessionId, shellId, data))
    const outputSub = window.ssh.onOutput((sid, shid, data) => {
      if (sid === sessionId && shid === shellId) term.write(data)
    })

    return () => {
      inputSub.dispose()
      outputSub()
      observer.disconnect()
      refitRef.current = null
      webgl?.dispose()
      const r = (window as unknown as { __xterms?: Record<string, Terminal> }).__xterms
      if (r) delete r[termKey]
      term.dispose()
    }
  }, [sessionId, shellId])

  useEffect(() => {
    const scheduler: FrameScheduler = {
      schedule: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id)
    }
    return scheduleTerminalRefit(active, () => refitRef.current?.(true), scheduler)
  }, [active])

  return <div ref={containerRef} className="terminal" />
}
