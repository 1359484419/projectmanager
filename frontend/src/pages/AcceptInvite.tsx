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

export default function AcceptInvite() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const t = useT()
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
      // 换账号加入：清空上个账号残留的 react-query 缓存，避免首帧串号
      queryClient.clear()
      navigate('/tenants')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t.requestFailed, 'info')
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
          <div style={{ fontSize: 16, fontWeight: 650 }}>{t.acceptInviteTitle}</div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--faint)',
              marginTop: 3,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            {t.acceptInviteHint1}
            <br />
            {t.acceptInviteHint2}
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
            <label style={fieldLabel}>{t.inviteToken}</label>
            <input
              style={{ ...fieldInput, fontFamily: 'var(--font-mono)' }}
              placeholder={t.inviteTokenPlaceholder}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
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
              style={fieldInput}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label style={fieldLabel}>{t.displayNameNewUser}</label>
            <input
              style={{ ...fieldInput, marginBottom: 18 }}
              placeholder={t.displayNameRegPlaceholder}
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
              {submitting ? t.submitting : t.joinTeam}
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
            {t.backToLogin}
          </Link>
        </p>
      </div>
    </div>
  )
}
