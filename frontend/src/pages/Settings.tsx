// 个人设置：改名、改密码、PAT 管理（生成/吊销 MCP 访问令牌，明文一次性展示 + 复制）。
// PAT 数据走 hooks（useTokens/useCreateToken/useRevokeToken）。
// 改名/改密码后端 /api/me 资料端点未在共享 hooks 中提供，按 API 前缀约定就地 fetch：
//   PATCH /api/me {displayName}；PUT /api/me/password {oldPassword, newPassword}。
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useCreateToken, useMyTenants, useRevokeToken, useTokens } from '../api/hooks'
import type { CreatedApiToken } from '../api/types'

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '16px 20px',
  marginBottom: 24,
  background: 'var(--bg)',
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  maxWidth: 360,
  boxSizing: 'border-box',
  padding: '8px 10px',
  marginBottom: 12,
  fontSize: 14,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text-h)',
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
}

const smallButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text-h)',
  cursor: 'pointer',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  color: 'var(--text-h)',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  borderBottom: '1px solid var(--border)',
}

/** 复制按钮：复制成功后短暂显示「已复制」 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('手动复制：', text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button type="button" onClick={copy} style={smallButtonStyle}>
      {copied ? '已复制 ✓' : '复制'}
    </button>
  )
}

/** 改名 */
function ProfileSection() {
  const [displayName, setDisplayName] = useState('')
  const rename = useMutation({
    mutationFn: (name: string) =>
      api<void>('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: name }) }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    rename.mutate(displayName.trim())
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>修改显示名</h2>
      <form onSubmit={handleSubmit}>
        <label style={labelStyle} htmlFor="displayName">
          新显示名
        </label>
        <input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="输入新的显示名"
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={rename.isPending || !displayName.trim()}
          style={{ ...buttonStyle, opacity: rename.isPending || !displayName.trim() ? 0.6 : 1 }}
        >
          {rename.isPending ? '保存中…' : '保存'}
        </button>
      </form>
      {rename.isSuccess && <p style={{ fontSize: 13, color: '#15803d', marginTop: 8 }}>已保存。</p>}
      {rename.isError && (
        <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>
          保存失败：{rename.error.message}
        </p>
      )}
    </section>
  )
}

/** 改密码 */
function PasswordSection() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && newPassword !== confirm
  const change = useMutation({
    mutationFn: (input: { oldPassword: string; newPassword: string }) =>
      api<void>('/api/me/password', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => {
      setOldPassword('')
      setNewPassword('')
      setConfirm('')
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!oldPassword || !newPassword || newPassword !== confirm) return
    change.mutate({ oldPassword, newPassword })
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>修改密码</h2>
      <form onSubmit={handleSubmit}>
        <label style={labelStyle} htmlFor="oldPassword">
          当前密码
        </label>
        <input
          id="oldPassword"
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />
        <label style={labelStyle} htmlFor="newPassword">
          新密码
        </label>
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          style={inputStyle}
        />
        <label style={labelStyle} htmlFor="confirmPassword">
          确认新密码
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          style={inputStyle}
        />
        {mismatch && (
          <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 8 }}>两次输入的新密码不一致。</p>
        )}
        <button
          type="submit"
          disabled={change.isPending || !oldPassword || !newPassword || mismatch}
          style={{
            ...buttonStyle,
            opacity: change.isPending || !oldPassword || !newPassword || mismatch ? 0.6 : 1,
          }}
        >
          {change.isPending ? '提交中…' : '修改密码'}
        </button>
      </form>
      {change.isSuccess && <p style={{ fontSize: 13, color: '#15803d', marginTop: 8 }}>密码已修改。</p>}
      {change.isError && (
        <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>
          修改失败：{change.error.message}
        </p>
      )}
    </section>
  )
}

/** PAT 管理：列表 / 生成（明文一次性展示 + 复制）/ 吊销 */
function TokensSection({ currentSlug }: { currentSlug: string }) {
  const tokens = useTokens()
  const tenants = useMyTenants()
  const createToken = useCreateToken()
  const revokeToken = useRevokeToken()

  const [name, setName] = useState('')
  const [tenantSlug, setTenantSlug] = useState(currentSlug)
  // 明文 token 只在创建响应里出现一次，存本地 state 展示
  const [created, setCreated] = useState<CreatedApiToken | null>(null)

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !tenantSlug) return
    createToken.mutate(
      { name: name.trim(), tenantSlug },
      {
        onSuccess: (data) => {
          setCreated(data)
          setName('')
        },
      },
    )
  }

  function handleRevoke(id: number, tokenName: string) {
    if (!window.confirm(`确认吊销令牌「${tokenName}」？使用它的 MCP 客户端将立即失效。`)) return
    revokeToken.mutate(id, {
      onSuccess: () => {
        if (created?.id === id) setCreated(null)
      },
    })
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>
        个人访问令牌（PAT / MCP）
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 12px' }}>
        令牌用于 MCP 客户端访问，绑定 用户 + 租户。明文只在生成时展示一次，请立即复制保存。
      </p>

      <form
        onSubmit={handleCreate}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}
      >
        <div>
          <label style={labelStyle} htmlFor="tokenName">
            令牌名称
          </label>
          <input
            id="tokenName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 my-laptop-claude"
            style={{ ...inputStyle, marginBottom: 0, width: 220 }}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="tokenTenant">
            绑定租户
          </label>
          <select
            id="tokenTenant"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            style={{ ...inputStyle, marginBottom: 0, width: 220 }}
          >
            {/* 租户列表加载前保留当前 slug 选项 */}
            {(tenants.data ?? (currentSlug ? [{ slug: currentSlug, name: currentSlug, role: 'MEMBER' as const }] : [])).map(
              (t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} (/{t.slug})
                </option>
              ),
            )}
          </select>
        </div>
        <button
          type="submit"
          disabled={createToken.isPending || !name.trim() || !tenantSlug}
          style={{
            ...buttonStyle,
            opacity: createToken.isPending || !name.trim() || !tenantSlug ? 0.6 : 1,
          }}
        >
          {createToken.isPending ? '生成中…' : '生成令牌'}
        </button>
      </form>
      {createToken.isError && (
        <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>
          生成失败：{createToken.error.message}
        </p>
      )}

      {created && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            border: '1px solid #f59e0b',
            borderRadius: 8,
            background: 'var(--code-bg)',
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: '#b45309' }}>
            令牌「{created.name}」已生成，明文只展示这一次：
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 13, wordBreak: 'break-all', flex: 1, minWidth: 200 }}>
              {created.token}
            </code>
            <CopyButton text={created.token} />
          </div>
        </div>
      )}

      {tokens.isLoading && <p style={{ fontSize: 14, color: 'var(--text)' }}>加载中…</p>}
      {tokens.isError && (
        <p style={{ fontSize: 14, color: '#dc2626' }}>令牌列表加载失败：{tokens.error.message}</p>
      )}
      {tokens.data && tokens.data.length === 0 && (
        <p style={{ fontSize: 14, color: 'var(--text)' }}>还没有令牌。</p>
      )}
      {tokens.data && tokens.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>名称</th>
              <th style={thStyle}>租户</th>
              <th style={thStyle}>创建时间</th>
              <th style={thStyle}>最近使用</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {tokens.data.map((tk) => (
              <tr key={tk.id}>
                <td style={tdStyle}>{tk.name}</td>
                <td style={tdStyle}>/{tk.tenantSlug}</td>
                <td style={tdStyle}>{new Date(tk.createdAt).toLocaleString()}</td>
                <td style={tdStyle}>
                  {tk.lastUsedAt ? new Date(tk.lastUsedAt).toLocaleString() : '从未使用'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => handleRevoke(tk.id, tk.name)}
                    disabled={revokeToken.isPending}
                    style={{ ...smallButtonStyle, color: '#dc2626', borderColor: '#dc2626' }}
                  >
                    吊销
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {revokeToken.isError && (
        <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>
          吊销失败：{revokeToken.error.message}
        </p>
      )}
    </section>
  )
}

export default function Settings() {
  const { slug = '' } = useParams<{ slug: string }>()
  return (
    <div style={{ padding: 24, maxWidth: 880 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>个人设置</h1>
      <ProfileSection />
      <PasswordSection />
      <TokensSection currentSlug={slug} />
    </div>
  )
}
