import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  shellId: string
}

export default function TerminalView({ sessionId, shellId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null)

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
    fit.fit()
    window.ssh.resize(sessionId, shellId, term.cols, term.rows)

    const sendResize = (): void => {
      const el = containerRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      fit.fit()
      term.refresh(0, term.rows - 1)
      const size = { cols: term.cols, rows: term.rows }
      if (sizeRef.current && sizeRef.current.cols === size.cols && sizeRef.current.rows === size.rows) return
      sizeRef.current = size
      window.ssh.resize(sessionId, shellId, size.cols, size.rows)
    }
    const observer = new ResizeObserver(sendResize)
    observer.observe(containerRef.current!)

    const inputSub = term.onData((data) => window.ssh.sendData(sessionId, shellId, data))
    const outputSub = window.ssh.onOutput((sid, shid, data) => {
      if (sid === sessionId && shid === shellId) term.write(data)
    })

    return () => {
      inputSub.dispose()
      outputSub()
      observer.disconnect()
      term.dispose()
    }
  }, [sessionId, shellId])

  return <div ref={containerRef} className="terminal" />
}
