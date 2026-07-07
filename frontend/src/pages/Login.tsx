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

const tabStyle = (active: boolean): CSSProperties => ({
  flex: 1,
  textAlign: 'center',
  padding: 7,
  borderRadius: 7,
  fontSize: 12.5,
  cursor: 'pointer',
  userSelect: 'none',
  ...(active
    ? {
        background: 'var(--card)',
        color: 'var(--text)',
        fontWeight: 600,
        boxShadow: 'var(--shadow-xs)',
      }
    : { color: 'var(--dim)' }),
})

type Mode = 'login' | 'register'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const pair = await api<TokenPair>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        setTokens(pair.accessToken, pair.refreshToken)
        // 会话过期被踢回登录时带上的 returnTo：只接受站内路径，防开放跳转
        const returnTo = searchParams.get('returnTo')
        navigate(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/tenants')
      } else {
        const pair = await api<TokenPair>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName, tenantName, tenantSlug }),
        })
        setTokens(pair.accessToken, pair.refreshToken)
        navigate(`/t/${tenantSlug}`)
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '请求失败，请稍后重试', 'info')
    } finally {
      setSubmitting(false)
    }
  }

  const isRegister = mode === 'register'

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
          <div style={{ fontSize: 16, fontWeight: 650 }}>欢迎回到 PM</div>
          <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 3 }}>
            {isRegister ? '创建你的团队空间' : '登录以继续你的项目管理'}
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
          <div
            style={{
              display: 'flex',
              gap: 4,
              background: 'var(--card-2)',
              borderRadius: 9,
              padding: 3,
              marginBottom: 18,
            }}
          >
            <span style={tabStyle(mode === 'login')} onClick={() => setMode('login')}>
              登录
            </span>
            <span style={tabStyle(mode === 'register')} onClick={() => setMode('register')}>
              注册
            </span>
          </div>
          <form onSubmit={handleSubmit}>
            {isRegister && (
              <>
                <label style={fieldLabel}>显示名</label>
                <input
                  style={fieldInput}
                  placeholder="张三"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
                <label style={fieldLabel}>团队名称</label>
                <input
                  style={fieldInput}
                  placeholder="Acme Inc."
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                />
                <label style={fieldLabel}>团队 slug</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    height: 36,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--card-2)',
                    padding: '0 11px',
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--faint)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    /t/
                  </span>
                  <input
                    placeholder="acme"
                    value={tenantSlug}
                    onChange={(e) => setTenantSlug(e.target.value)}
                    pattern="[a-z0-9-]{3,32}"
                    title="3-32 位小写字母、数字或连字符"
                    required
                    style={{
                      flex: 1,
                      height: 34,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--text)',
                      fontSize: 13,
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
              </>
            )}
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
              style={{ ...fieldInput, marginBottom: 18 }}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
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
              {submitting ? '提交中…' : isRegister ? '创建团队' : '登录'}
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
          收到邀请链接？
          <Link to="/accept-invite" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            接受邀请
          </Link>
        </p>
      </div>
    </div>
  )
}
