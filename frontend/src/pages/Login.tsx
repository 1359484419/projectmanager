import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, setTokens } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { validateRegister, type FieldErrorKey, type RegisterErrors } from '../utils/validation'
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

const fieldErrorStyle: CSSProperties = { fontSize: 11, color: 'var(--type-bug)', marginTop: -8, marginBottom: 10 }

function errorText(key: FieldErrorKey | undefined, t: ReturnType<typeof useT>): string | null {
  if (!key) return null
  return { required: t.errRequired, email: t.errEmail, password: t.errPassword, slug: t.errSlug, mismatch: t.errMismatch }[key]
}

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
  // 受控校验：字段离焦或提交后才显示行内错误；提交按钮在有错时禁用
  const [touched, setTouched] = useState<Partial<Record<keyof RegisterErrors, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const isRegister = mode === 'register'
  const errors: RegisterErrors = isRegister
    ? validateRegister({ displayName, tenantName, tenantSlug, email, password, confirmPassword: confirmPwd })
    : {}
  const hasErrors = Object.keys(errors).length > 0
  const touch = (k: keyof RegisterErrors) => () => setTouched((prev) => ({ ...prev, [k]: true }))
  const showErr = (k: keyof RegisterErrors) => (touched[k] || submitted ? errorText(errors[k], t) : null)
  const fieldBorder = (k: keyof RegisterErrors) => (showErr(k) ? 'var(--type-bug)' : 'var(--border)')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (isRegister && hasErrors) return
    if (!isRegister && (!email || !password)) return
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
      // 后端 auth 错误码 → 本地化文案，避免直接把英文 message 抛给用户
      const codeText: Record<string, string> = {
        INVALID_SLUG: t.errInvalidSlug,
        SLUG_TAKEN: t.errSlugTaken,
        EMAIL_TAKEN: t.errEmailTaken,
        BAD_CREDENTIALS: t.errBadCredentials,
      }
      const msg = err instanceof ApiError && codeText[err.code] ? codeText[err.code] : apiErrorMessage(err, t)
      toast.show(msg, 'info')
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
              fontSize: 20,
              marginBottom: 12,
            }}
          >
            跬
          </div>
          <div style={{ fontSize: 16, fontWeight: 650 }}>{isRegister ? t.registerTitle : t.welcomeBack}</div>
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
          <form onSubmit={handleSubmit} noValidate>
            {isRegister && (
              <>
                <label style={fieldLabel}>{t.displayNameLabel}</label>
                <input
                  style={{ ...fieldInput, borderColor: fieldBorder('displayName') }}
                  placeholder={t.displayNameRegPlaceholder}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onBlur={touch('displayName')}
                  aria-label={t.displayNameLabel}
                />
                {showErr('displayName') && <div style={fieldErrorStyle}>{showErr('displayName')}</div>}
                <label style={fieldLabel}>{t.teamName}</label>
                <input
                  style={{ ...fieldInput, borderColor: fieldBorder('tenantName') }}
                  placeholder={t.teamNamePlaceholder}
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  onBlur={touch('tenantName')}
                  aria-label={t.teamName}
                />
                {showErr('tenantName') && <div style={fieldErrorStyle}>{showErr('tenantName')}</div>}
                <label style={fieldLabel}>{t.teamSlug}</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    height: 36,
                    borderRadius: 8,
                    border: `1px solid ${fieldBorder('tenantSlug')}`,
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
                    onChange={(e) => setTenantSlug(e.target.value.trim().toLowerCase())}
                    onBlur={touch('tenantSlug')}
                    aria-label={t.teamSlug}
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
                <div style={{ ...(showErr('tenantSlug') ? fieldErrorStyle : { fontSize: 11, color: 'var(--faint)', marginTop: -8, marginBottom: 10 }) }}>
                  {showErr('tenantSlug') ?? t.slugHint}
                </div>
              </>
            )}
            <label style={fieldLabel}>{t.email}</label>
            <input
              style={{ ...fieldInput, borderColor: fieldBorder('email') }}
              type="email"
              placeholder="you@acme.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={touch('email')}
              aria-label={t.email}
              autoComplete="email"
            />
            {showErr('email') && <div style={fieldErrorStyle}>{showErr('email')}</div>}
            <label style={fieldLabel}>{t.password}</label>
            <input
              style={{ ...fieldInput, marginBottom: isRegister ? 4 : 18, borderColor: fieldBorder('password') }}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={touch('password')}
              aria-label={t.password}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {isRegister && (
              <div style={{ fontSize: 11, color: showErr('password') ? 'var(--type-bug)' : 'var(--faint)', marginBottom: 8 }}>
                {showErr('password') ?? t.passwordMinHint}
              </div>
            )}
            {isRegister && (
              <>
                <label style={fieldLabel}>{t.confirmPassword}</label>
                <input
                  style={{ ...fieldInput, marginBottom: 4, borderColor: fieldBorder('confirmPassword') }}
                  type="password"
                  placeholder={t.confirmPasswordRegPlaceholder}
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  onBlur={touch('confirmPassword')}
                  aria-label={t.confirmPassword}
                  autoComplete="new-password"
                />
                {showErr('confirmPassword') && (
                  <div style={{ fontSize: 11, color: 'var(--type-bug)', marginBottom: 8 }}>{showErr('confirmPassword')}</div>
                )}
                <div style={{ marginBottom: 10 }} />
              </>
            )}
            <button
              type="submit"
              disabled={submitting || (isRegister && submitted && hasErrors)}
              style={{
                width: '100%',
                height: 38,
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: submitting || (isRegister && submitted && hasErrors) ? 'default' : 'pointer',
                opacity: submitting || (isRegister && submitted && hasErrors) ? 0.65 : 1,
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
