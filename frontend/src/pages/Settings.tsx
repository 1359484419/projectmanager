// 个人设置：改名、改密码、PAT 管理（生成/吊销 MCP 访问令牌，明文一次性展示 + 复制）。
// PAT 数据走 hooks（useTokens/useCreateToken/useRevokeToken）。
// 改名/改密码后端 /api/me 资料端点未在共享 hooks 中提供，按 API 前缀约定就地 fetch：
//   PATCH /api/me {displayName}；PUT /api/me/password {oldPassword, newPassword}。
// 视觉真源：docs/design/mock/markup.html（SETTINGS 节）。
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useCreateToken, useMyTenants, useRevokeToken, useTokens } from '../api/hooks'
import {
  ConfirmDialog,
  Icon,
  SelectWrap,
  cardStyle,
  inputStyle,
  labelStyle,
  pageTitleStyle,
  selStyle,
  useToast,
} from '../components/ui'
import type { ApiToken, CreatedApiToken } from '../api/types'

/** 卡片内小节标题（13px/600） */
const sectionTitleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }

/** 主按钮（设计稿「生成 Token」形态：28px accent 实底） */
const accentBtnStyle: React.CSSProperties = {
  height: 28,
  padding: '0 12px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

/** 复制按钮（设计稿 copyToken 形态：卡片底 + copy 图标） */
function CopyButton({ text, doneMsg }: { text: string; doneMsg: string }) {
  const toast = useToast()
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.show(doneMsg)
    } catch {
      // clipboard API 不可用（如非 https）时退化为 prompt
      window.prompt('手动复制：', text)
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="hover-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        height: 26,
        padding: '0 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--text)',
        fontSize: 11.5,
        cursor: 'pointer',
        flex: 'none',
      }}
    >
      <Icon name="copy" size={12} />
      复制
    </button>
  )
}

/** 个人资料卡片：昵称 + 修改密码 */
function ProfileCard() {
  const toast = useToast()
  const [displayName, setDisplayName] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && newPassword !== confirm

  const rename = useMutation({
    mutationFn: (name: string) =>
      api<void>('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: name }) }),
    onSuccess: () => toast.show('显示名已保存'),
    onError: (err) => toast.show(`保存失败：${err.message}`, 'info'),
  })

  const change = useMutation({
    mutationFn: (input: { oldPassword: string; newPassword: string }) =>
      api<void>('/api/me/password', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => {
      setOldPassword('')
      setNewPassword('')
      setConfirm('')
      toast.show('密码已修改')
    },
    onError: (err) => toast.show(`修改失败：${err.message}`, 'info'),
  })

  function handleRename(e: FormEvent) {
    e.preventDefault()
    if (!displayName.trim() || rename.isPending) return
    rename.mutate(displayName.trim())
  }

  function handlePassword(e: FormEvent) {
    e.preventDefault()
    if (!oldPassword || !newPassword || newPassword !== confirm || change.isPending) return
    change.mutate({ oldPassword, newPassword })
  }

  return (
    <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
      <div style={{ ...sectionTitleStyle, marginBottom: 14 }}>个人资料</div>

      {/* 昵称 */}
      <form onSubmit={handleRename}>
        <label style={labelStyle} htmlFor="displayName">
          昵称
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="输入新的显示名"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="submit"
            disabled={rename.isPending || !displayName.trim()}
            className="btn-primary"
            style={{
              ...accentBtnStyle,
              height: 34,
              borderRadius: 8,
              opacity: rename.isPending || !displayName.trim() ? 0.6 : 1,
            }}
          >
            {rename.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      {/* 修改密码 */}
      <form onSubmit={handlePassword}>
        <label style={labelStyle} htmlFor="oldPassword">
          修改密码
        </label>
        <input
          id="oldPassword"
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder="当前密码"
          autoComplete="current-password"
          style={{ ...inputStyle, marginBottom: 8 }}
        />
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="新密码"
          autoComplete="new-password"
          aria-label="新密码"
          style={{ ...inputStyle, marginBottom: 8 }}
        />
        <input
          id="confirmPassword"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="确认新密码"
          autoComplete="new-password"
          aria-label="确认新密码"
          style={{
            ...inputStyle,
            marginBottom: 10,
            borderColor: mismatch ? 'var(--type-bug)' : 'var(--border)',
          }}
        />
        {mismatch && (
          <div style={{ fontSize: 11.5, color: 'var(--type-bug)', marginBottom: 10 }}>
            两次输入的新密码不一致
          </div>
        )}
        <button
          type="submit"
          disabled={change.isPending || !oldPassword || !newPassword || mismatch}
          className="hover-card"
          style={{
            height: 30,
            padding: '0 12px',
            borderRadius: 7,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            fontSize: 12.5,
            fontWeight: 550,
            cursor: 'pointer',
            opacity: change.isPending || !oldPassword || !newPassword || mismatch ? 0.6 : 1,
          }}
        >
          {change.isPending ? '提交中…' : '修改密码'}
        </button>
      </form>
    </div>
  )
}

/** PAT 卡片：生成（一次性明文 + 警示 + 复制）/ 列表 / 吊销（ConfirmDialog） */
function TokensCard({ currentSlug }: { currentSlug: string }) {
  const toast = useToast()
  const tokens = useTokens()
  const tenants = useMyTenants()
  const createToken = useCreateToken()
  const revokeToken = useRevokeToken()

  const [name, setName] = useState('')
  const [tenantSlug, setTenantSlug] = useState(currentSlug)
  // 明文 token 只在创建响应里出现一次，存本地 state 展示
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !tenantSlug || createToken.isPending) return
    createToken.mutate(
      { name: name.trim(), tenantSlug },
      {
        onSuccess: (data) => {
          setCreated(data)
          setName('')
          toast.show('Token 已生成，请立即复制保存')
        },
        onError: (err) => toast.show(`生成失败：${err.message}`, 'info'),
      },
    )
  }

  function confirmRevoke() {
    if (!revoking) return
    const target = revoking
    revokeToken.mutate(target.id, {
      onSuccess: () => {
        if (created?.id === target.id) setCreated(null)
        toast.show(`令牌「${target.name}」已吊销`)
      },
      onError: (err) => toast.show(`吊销失败：${err.message}`, 'info'),
    })
    setRevoking(null)
  }

  const list = tokens.data ?? []

  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={sectionTitleStyle}>个人访问令牌 (PAT)</span>
        <span style={{ flex: 1 }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 14 }}>
        用于 API / MCP 集成访问。明文只在生成时展示一次，请立即复制保存。
      </div>

      {/* 生成表单（真实 API 需要名称 + 绑定租户） */}
      <form
        onSubmit={handleCreate}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}
      >
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle} htmlFor="tokenName">
            令牌名称
          </label>
          <input
            id="tokenName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 my-laptop-claude"
            style={inputStyle}
          />
        </div>
        <div style={{ width: 200 }}>
          <label style={labelStyle} htmlFor="tokenTenant">
            绑定租户
          </label>
          <SelectWrap chevronTop={11}>
            <select
              id="tokenTenant"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              style={{ ...selStyle, height: 34, borderRadius: 8, fontSize: 13 }}
            >
              {/* 租户列表加载前保留当前 slug 选项 */}
              {(tenants.data ??
                (currentSlug ? [{ slug: currentSlug, name: currentSlug, role: 'MEMBER' as const }] : [])).map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} (/{t.slug})
                </option>
              ))}
            </select>
          </SelectWrap>
        </div>
        <button
          type="submit"
          disabled={createToken.isPending || !name.trim() || !tenantSlug}
          className="btn-primary"
          style={{
            ...accentBtnStyle,
            height: 34,
            borderRadius: 8,
            opacity: createToken.isPending || !name.trim() || !tenantSlug ? 0.6 : 1,
          }}
        >
          {createToken.isPending ? '生成中…' : '生成 Token'}
        </button>
      </form>

      {/* 一次性明文展示（comp 警示框） */}
      {created && (
        <div
          style={{
            border: '1px solid var(--comp)',
            background: 'var(--comp-soft)',
            borderRadius: 9,
            padding: '12px 13px',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 11.5,
              color: 'var(--comp)',
              fontWeight: 600,
              marginBottom: 9,
            }}
          >
            <Icon name="alert" size={14} />
            此 Token（{created.name}）只显示一次，请立即保存
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: '9px 11px',
            }}
          >
            <span
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--comp)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: '.01em',
              }}
            >
              {created.token}
            </span>
            <CopyButton text={created.token} doneMsg="Token 已复制" />
          </div>
        </div>
      )}

      {/* 令牌列表 */}
      {tokens.isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1].map((i) => (
            <span key={i} className="sk" style={{ height: 34, borderRadius: 8 }} />
          ))}
        </div>
      )}
      {tokens.isError && (
        <div style={{ fontSize: 12.5, color: 'var(--type-bug)' }}>
          令牌列表加载失败：{tokens.error.message}
        </div>
      )}
      {tokens.data && list.length === 0 && !created && (
        <div
          style={{
            border: '1px dashed var(--border-strong)',
            borderRadius: 9,
            padding: 20,
            textAlign: 'center',
            fontSize: 12.5,
            color: 'var(--faint)',
          }}
        >
          尚未生成任何 Token
        </div>
      )}
      {list.length > 0 && (
        <div>
          {list.map((tk, i) => (
            <div
              key={tk.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 2px',
                borderTop: i > 0 ? '1px solid var(--border-soft)' : 'none',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 550, minWidth: 100 }}>{tk.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--dim)' }}>
                /{tk.tenantSlug}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>
                创建于 {new Date(tk.createdAt).toLocaleString()}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>
                {tk.lastUsedAt ? `最近使用 ${new Date(tk.lastUsedAt).toLocaleString()}` : '从未使用'}
              </span>
              <button
                type="button"
                onClick={() => setRevoking(tk)}
                disabled={revokeToken.isPending}
                className="hover-card"
                style={{
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--type-bug)',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  flex: 'none',
                  opacity: revokeToken.isPending ? 0.6 : 1,
                }}
              >
                吊销
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        title="吊销该令牌？"
        message={
          revoking
            ? `令牌「${revoking.name}」将立即失效，使用它的 MCP 客户端将无法继续访问。此操作不可撤销。`
            : undefined
        }
        actionLabel="吊销"
        onConfirm={confirmRevoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  )
}

export default function Settings() {
  const { slug = '' } = useParams<{ slug: string }>()
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ ...pageTitleStyle, margin: '0 0 18px' }}>个人设置</h1>
        <ProfileCard />
        <TokensCard currentSlug={slug} />
      </div>
    </div>
  )
}
