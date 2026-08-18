import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
}

export default function TerminalView({ sessionId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
      scrollback: 5000,
      theme: {
        background: '#0f1115',
        foreground: '#e6e6e6',
        cursor: '#ffcc66'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)

    term.open(containerRef.current!)
    fit.fit()
    window.ssh.resize(sessionId, term.cols, term.rows)

    const sendResize = (): void => {
      const el = containerRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      fit.fit()
      term.refresh(0, term.rows - 1)
      const size = { cols: term.cols, rows: term.rows }
      if (sizeRef.current && sizeRef.current.cols === size.cols && sizeRef.current.rows === size.rows) return
      sizeRef.current = size
      window.ssh.resize(sessionId, size.cols, size.rows)
    }
    const observer = new ResizeObserver(sendResize)
    observer.observe(containerRef.current!)

    const inputSub = term.onData((data) => window.ssh.sendData(sessionId, data))
    const outputSub = window.ssh.onOutput((sid, data) => {
      if (sid === sessionId) term.write(data)
    })

    return () => {
      inputSub.dispose()
      outputSub()
      observer.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className="terminal" />
}
