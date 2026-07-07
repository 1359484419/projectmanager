import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, setTokens } from '../api/client'
import type { TokenPair } from '../api/types'
import { useToast } from '../components/ui'

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--dim)',
  marginBottom: 5,
}

const fieldInput: CSSProperties = {
  width: '100%',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card-2)',
  color: 'var(--text)',
  fontSize: 13,
  padding: '0 11px',
  marginBottom: 12,
  outline: 'none',
}

export default function AcceptInvite() {
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const pair = await api<TokenPair>('/api/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token, email, password, displayName }),
      })
      setTokens(pair.accessToken, pair.refreshToken)
      navigate('/tenants')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '请求失败，请稍后重试', 'info')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn .15s',
      }}
    >
      <div style={{ width: 380, maxWidth: '92vw' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 26,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 22,
              marginBottom: 12,
            }}
          >
            P
          </div>
          <div style={{ fontSize: 16, fontWeight: 650 }}>接受邀请</div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--faint)',
              marginTop: 3,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            新用户填写全部信息完成注册并加入；
            <br />
            已有账号填注册时的邮箱与密码即可。
          </div>
        </div>
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 20,
            boxShadow: 'var(--shadow)',
          }}
        >
          <form onSubmit={handleSubmit}>
            <label style={fieldLabel}>邀请 token</label>
            <input
              style={{ ...fieldInput, fontFamily: 'var(--font-mono)' }}
              placeholder="粘贴邀请 token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <label style={fieldLabel}>邮箱</label>
            <input
              style={fieldInput}
              type="email"
              placeholder="you@acme.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label style={fieldLabel}>密码</label>
            <input
              style={fieldInput}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label style={fieldLabel}>显示名（新用户必填）</label>
            <input
              style={{ ...fieldInput, marginBottom: 18 }}
              placeholder="张三"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                height: 38,
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: submitting ? 'default' : 'pointer',
                opacity: submitting ? 0.65 : 1,
              }}
            >
              {submitting ? '提交中…' : '加入团队'}
            </button>
          </form>
        </div>
        <p
          style={{
            marginTop: 16,
            fontSize: 13,
            color: 'var(--dim)',
            textAlign: 'center',
          }}
        >
          <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            返回登录
          </Link>
        </p>
      </div>
    </div>
  )
}
