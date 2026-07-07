import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setTokens } from '../api/client'
import type { TokenPair } from '../api/types'

const cardStyle: React.CSSProperties = {
  maxWidth: 400,
  margin: '80px auto',
  padding: 32,
  textAlign: 'left',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow)',
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  marginBottom: 12,
  fontSize: 15,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text-h)',
}

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 0',
  fontSize: 15,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
}

const errorStyle: React.CSSProperties = {
  margin: '0 0 12px',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 6,
  background: 'rgba(220, 38, 38, 0.1)',
  color: '#dc2626',
}

type Mode = 'login' | 'register'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const pair = await api<TokenPair>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        setTokens(pair.accessToken, pair.refreshToken)
        navigate('/tenants')
      } else {
        const pair = await api<TokenPair>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName, tenantName, tenantSlug }),
        })
        setTokens(pair.accessToken, pair.refreshToken)
        navigate(`/t/${tenantSlug}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    fontSize: 15,
    fontWeight: 600,
    textAlign: 'center',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    color: active ? 'var(--accent)' : 'var(--text)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  })

  return (
    <div style={cardStyle}>
      <h2 style={{ textAlign: 'center' }}>Mini Jira</h2>
      <div style={{ display: 'flex', marginBottom: 20 }}>
        <button type="button" style={tabStyle(mode === 'login')} onClick={() => setMode('login')}>
          登录
        </button>
        <button
          type="button"
          style={tabStyle(mode === 'register')}
          onClick={() => setMode('register')}
        >
          注册
        </button>
      </div>
      {error && <p style={errorStyle}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <input
          style={inputStyle}
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          style={inputStyle}
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {mode === 'register' && (
          <>
            <input
              style={inputStyle}
              placeholder="显示名"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
            <input
              style={inputStyle}
              placeholder="租户名（团队/公司名）"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              required
            />
            <input
              style={inputStyle}
              placeholder="租户 slug（3-32 位小写字母/数字/-）"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              pattern="[a-z0-9-]{3,32}"
              title="3-32 位小写字母、数字或连字符"
              required
            />
          </>
        )}
        <button style={buttonStyle} type="submit" disabled={submitting}>
          {submitting ? '提交中…' : mode === 'login' ? '登录' : '注册并创建租户'}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
        收到邀请链接？<Link to="/accept-invite">接受邀请</Link>
      </p>
    </div>
  )
}
