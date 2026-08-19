import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  placeholder?: string
  initial?: string
  confirmText?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export default function PromptDialog({
  title,
  placeholder,
  initial = '',
  confirmText = '确定',
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    const v = value.trim()
    if (!v) return
    onSubmit(v)
  }

  return (
    <div
      className="prompt-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="prompt-dialog" role="dialog" aria-modal="true">
        <div className="prompt-title">{title}</div>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="prompt-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={submit}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
