import { useState } from 'react'
import type { Profile } from '@shared/types'

interface Props {
  initial: Profile | null
  onSave: (profile: Profile) => void
  onCancel: () => void
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function ProfileForm({ initial, onSave, onCancel }: Props): React.JSX.Element {
  const [form, setForm] = useState<Profile>(
    initial ?? {
      id: newId(),
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      keyPath: '',
      passphrase: ''
    }
  )
  const [error, setError] = useState('')

  const set = (patch: Partial<Profile>): void => setForm((f) => ({ ...f, ...patch }))

  const pickKey = async (): Promise<void> => {
    const { canceled, filePath } = await window.ssh.pickKeyFile()
    if (!canceled && filePath) set({ keyPath: filePath })
  }

  const submit = (): void => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setError('请填写名称、主机地址和用户名')
      return
    }
    if (form.authType === 'password' && !form.password) {
      setError('请输入密码')
      return
    }
    if (form.authType === 'key' && !form.keyPath) {
      setError('请选择 PEM 私钥文件')
      return
    }
    onSave(form)
  }

  return (
    <div className="form-wrap">
      <h2>{initial ? '编辑服务器' : '新建服务器'}</h2>
      <div className="form">
        <label>
          名称
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如:生产环境" />
        </label>
        <label>
          主机地址
          <input value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="example.com 或 1.2.3.4" />
        </label>
        <div className="form-row">
          <label>
            端口
            <input
              type="number"
              value={form.port}
              onChange={(e) => set({ port: Number(e.target.value) || 22 })}
            />
          </label>
          <label>
            用户名
            <input value={form.username} onChange={(e) => set({ username: e.target.value })} placeholder="root" />
          </label>
        </div>

        <div className="auth-type">
          <button
            className={`btn ${form.authType === 'password' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => set({ authType: 'password', keyPath: '' })}
          >
            密码登录
          </button>
          <button
            className={`btn ${form.authType === 'key' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => set({ authType: 'key', password: '' })}
          >
            PEM 私钥
          </button>
        </div>

        {form.authType === 'password' ? (
          <label>
            密码
            <input
              type="password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder="服务器登录密码"
            />
          </label>
        ) : (
          <>
            <label>
              PEM 私钥文件
              <div className="key-picker">
                <input value={form.keyPath} onChange={(e) => set({ keyPath: e.target.value })} placeholder="/Users/you/.ssh/id_rsa.pem" />
                <button className="btn btn-ghost" onClick={() => void pickKey()}>
                  浏览…
                </button>
              </div>
            </label>
            <label>
              私钥口令(可选)
              <input
                type="password"
                value={form.passphrase}
                onChange={(e) => set({ passphrase: e.target.value })}
                placeholder="若私钥无口令请留空"
              />
            </label>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <button className="btn btn-primary" onClick={submit}>
            保存并连接
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
