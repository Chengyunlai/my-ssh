import { useState } from 'react'
import type { Profile } from '@shared/types'
import { ArrowBackIcon } from './icons'
import { useSmoothProgress } from '../hooks/useSmoothProgress'

interface Props {
  initial: Profile | null
  onSave: (profile: Profile) => void
  onCancel: () => void
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok' }
  | { status: 'fail'; message: string }

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
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [copied, setCopied] = useState(false)
  const [testProgress, setTestProgress] = useState(0)
  const smoothTestProgress = useSmoothProgress(testProgress, test.status === 'testing')

  const set = (patch: Partial<Profile>): void => setForm((f) => ({ ...f, ...patch }))

  const pickKey = async (): Promise<void> => {
    const { canceled, filePath } = await window.ssh.pickKeyFile()
    if (!canceled && filePath) set({ keyPath: filePath })
  }

  const validate = (): string | null => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      return '请填写名称、主机地址和用户名'
    }
    if (form.authType === 'password' && !form.password) {
      return '请输入密码'
    }
    if (form.authType === 'key' && !form.keyPath) {
      return '请选择 PEM 私钥文件'
    }
    return null
  }

  const submit = (): void => {
    const msg = validate()
    if (msg) {
      setError(msg)
      return
    }
    onSave(form)
  }

  const runTest = async (): Promise<void> => {
    const msg = validate()
    if (msg) {
      setTest({ status: 'fail', message: msg })
      return
    }
    setError('')
    setTest({ status: 'testing' })
    setTestProgress(0)
    const off = window.ssh.onProgress((p) => {
      if (p.sessionId === undefined) setTestProgress(p.percent)
    })
    try {
      const res = await window.ssh.testConnect(form)
      setTest(res.ok ? { status: 'ok' } : { status: 'fail', message: res.message ?? '未知错误' })
    } catch (err) {
      setTest({ status: 'fail', message: err instanceof Error ? err.message : String(err) })
    } finally {
      off()
    }
  }

  const copyReport = async (): Promise<void> => {
    const info = await window.ssh.appInfo().catch(() => null)
    const lines = [
      '## MySSH 连接问题',
      '',
      `- 时间: ${new Date().toLocaleString('zh-CN')}`,
      `- 应用: ${info ? `${info.name} ${info.version}` : 'unknown'}(${window.ssh.platform})`,
      `- 名称: ${form.name}`,
      `- 主机: ${form.host}:${form.port}`,
      `- 用户名: ${form.username}`,
      `- 认证方式: ${form.authType === 'password' ? '密码' : 'PEM 私钥'}`,
      `- 错误信息: ${test.status === 'fail' ? test.message : ''}`,
      '',
      '复现步骤:',
      '1. 填写以上配置后点击「测试连接」',
      '2. 将「错误信息」一并贴入 issue'
    ]
    window.ssh.copyText(lines.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="profile-form">
      <div className="profile-form-head">
        <h2>{initial ? '编辑服务器' : '新建服务器'}</h2>
        <button className="btn btn-ghost" onClick={onCancel}>
          <ArrowBackIcon size={14} /> 返回
        </button>
      </div>
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

        {test.status !== 'idle' && (
          <div className={`test-result test-${test.status}`}>
            {test.status === 'testing' && (
              <>
                <span className="test-label">正在测试连接…</span>
                <div className="test-progress">
                  <div className="test-progress-inner" style={{ width: `${smoothTestProgress}%` }} />
                </div>
              </>
            )}
            {test.status === 'ok' && <span className="test-label">连接成功</span>}
            {test.status === 'fail' && (
              <>
                <span className="test-label">连接失败</span>
                <code className="test-error">{test.message}</code>
                <button className="btn btn-xs" onClick={() => void copyReport()}>
                  {copied ? '已复制' : '复制问题'}
                </button>
              </>
            )}
          </div>
        )}

        <div className="profile-form-foot">
          {error && <p className="form-error">{error}</p>}
          <button
            className="btn btn-ghost"
            onClick={() => void runTest()}
            disabled={test.status === 'testing'}
          >
            {test.status === 'testing' ? '测试中…' : '测试连接'}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            保存并连接
          </button>
        </div>
      </div>
    </div>
  )
}
