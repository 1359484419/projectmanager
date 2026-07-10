import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, setTokens } from '../api/client'
import type { TokenPair } from '../api/types'
import { useToast } from '../components/ui'
import { useT } from '../i18n'

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
  const queryClient = useQueryClient()
  const toast = useToast()
  const t = useT()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
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
        // 换账号登录：清空上个账号残留的 react-query 缓存，避免首帧串号
        queryClient.clear()
        // 会话过期被踢回登录时带上的 returnTo：只接受站内路径，防开放跳转
        const returnTo = searchParams.get('returnTo')
        navigate(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/tenants')
      } else {
        const pair = await api<TokenPair>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName, tenantName, tenantSlug }),
        })
        setTokens(pair.accessToken, pair.refreshToken)
        queryClient.clear()
        navigate(`/t/${tenantSlug}`)
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t.requestFailed, 'info')
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
          <div style={{ fontSize: 16, fontWeight: 650 }}>{t.welcomeBack}</div>
          <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 3 }}>
            {isRegister ? t.registerSubtitle : t.loginSubtitle}
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
              {t.login}
            </span>
            <span style={tabStyle(mode === 'register')} onClick={() => setMode('register')}>
              {t.register}
            </span>
          </div>
          <form onSubmit={handleSubmit}>
            {isRegister && (
              <>
                <label style={fieldLabel}>{t.displayNameLabel}</label>
                <input
                  style={fieldInput}
                  placeholder={t.displayNameRegPlaceholder}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
                <label style={fieldLabel}>{t.teamName}</label>
                <input
                  style={fieldInput}
                  placeholder="Acme Inc."
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                />
                <label style={fieldLabel}>{t.teamSlug}</label>
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
                    title={t.slugHint}
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
            <label style={fieldLabel}>{t.email}</label>
            <input
              style={fieldInput}
              type="email"
              placeholder="you@acme.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label style={fieldLabel}>{t.password}</label>
            <input
              style={{ ...fieldInput, marginBottom: isRegister ? 4 : 18 }}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={isRegister ? 8 : undefined}
              required
            />
            {isRegister && (
              <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 8 }}>
                {t.passwordMinHint}
              </div>
            )}
            {isRegister && (
              <>
                <label style={fieldLabel}>{t.confirmPassword}</label>
                <input
                  style={{
                    ...fieldInput,
                    marginBottom: 4,
                    borderColor: confirmPwd && password !== confirmPwd ? 'var(--type-bug)' : 'var(--border)',
                  }}
                  type="password"
                  placeholder={t.confirmPasswordRegPlaceholder}
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  required
                />
                {confirmPwd && password !== confirmPwd && (
                  <div style={{ fontSize: 11, color: 'var(--type-bug)', marginBottom: 8 }}>
                    {t.passwordRegMismatch}
                  </div>
                )}
                <div style={{ marginBottom: 10 }} />
              </>
            )}
            <button
              type="submit"
              disabled={submitting || (isRegister && (password !== confirmPwd || password.length < 8))}
              style={{
                width: '100%',
                height: 38,
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: submitting || (isRegister && (password !== confirmPwd || password.length < 8)) ? 'default' : 'pointer',
                opacity: submitting || (isRegister && (password !== confirmPwd || password.length < 8)) ? 0.65 : 1,
              }}
            >
              {submitting ? t.submitting : isRegister ? t.createTeam : t.login}
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
          {t.invitePrompt}
          <Link to="/accept-invite" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            {t.acceptInvite}
          </Link>
        </p>
      </div>
    </div>
  )
}
