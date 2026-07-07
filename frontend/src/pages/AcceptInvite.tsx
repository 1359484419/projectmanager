import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, setTokens } from '../api/client'
import type { TokenPair } from '../api/types'

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

export default function AcceptInvite() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const pair = await api<TokenPair>('/api/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token, email, password, displayName }),
      })
      setTokens(pair.accessToken, pair.refreshToken)
      navigate('/tenants')
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        maxWidth: 400,
        margin: '80px auto',
        padding: 32,
        textAlign: 'left',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow)',
      }}
    >
      <h2 style={{ textAlign: 'center' }}>接受邀请</h2>
      <p style={{ marginBottom: 20, fontSize: 14, textAlign: 'center' }}>
        新用户填写全部信息完成注册并加入；已有账号填注册时的邮箱与密码即可加入。
      </p>
      {error && <p style={errorStyle}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <input
          style={inputStyle}
          placeholder="邀请 token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
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
        <input
          style={inputStyle}
          placeholder="显示名（新用户必填）"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button style={buttonStyle} type="submit" disabled={submitting}>
          {submitting ? '提交中…' : '加入租户'}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
        <Link to="/login">返回登录</Link>
      </p>
    </div>
  )
}
