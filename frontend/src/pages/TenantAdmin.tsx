// 租户管理（仅 ADMIN）：成员列表、生成邀请链接（复制）、项目默认 Sprint 周期与 auto_rotate 开关。
// 数据：GET /api/t/{slug}/members、POST /api/t/{slug}/invites、
//       GET /api/t/{slug}/projects、PATCH /api/t/{slug}/projects/{key}。
// 非 ADMIN 调用 members/invites 时后端按约定返回 404，页面据此展示无权限提示。
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useCreateInvite, useCreateProject, useMembers, useProjects, useUpdateProject } from '../api/hooks'
import { ApiError } from '../api/client'
import type { Invite, Project, Role, SprintLength } from '../api/types'

const SPRINT_LENGTHS: { value: SprintLength; label: string }[] = [
  { value: 'WEEK_1', label: '1 周' },
  { value: 'WEEK_2', label: '2 周' },
  { value: 'MONTH_1', label: '1 个月' },
]

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '16px 20px',
  marginBottom: 24,
  background: 'var(--bg)',
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

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        background: role === 'ADMIN' ? 'var(--accent-bg)' : 'var(--code-bg)',
        color: role === 'ADMIN' ? 'var(--accent)' : 'var(--text)',
      }}
    >
      {role}
    </span>
  )
}

/** 复制按钮：复制成功后短暂显示「已复制」 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard API 不可用（如非 https）时退化为 prompt
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

/** 成员列表 */
function MembersSection({ slug }: { slug: string }) {
  const members = useMembers(slug)
  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>成员</h2>
      {members.isLoading && <p style={{ fontSize: 14, color: 'var(--text)' }}>加载中…</p>}
      {members.isError && (
        <p style={{ fontSize: 14, color: '#dc2626' }}>
          {members.error instanceof ApiError && members.error.status === 404
            ? '无权查看成员列表（仅 ADMIN 可访问本页）。'
            : `成员加载失败：${members.error.message}`}
        </p>
      )}
      {members.data && members.data.length === 0 && (
        <p style={{ fontSize: 14, color: 'var(--text)' }}>暂无成员。</p>
      )}
      {members.data && members.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>姓名</th>
              <th style={thStyle}>邮箱</th>
              <th style={thStyle}>角色</th>
            </tr>
          </thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.userId}>
                <td style={tdStyle}>{m.displayName}</td>
                <td style={tdStyle}>{m.email}</td>
                <td style={tdStyle}>
                  <RoleBadge role={m.role} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** 生成邀请链接 */
function InviteSection({ slug }: { slug: string }) {
  const [role, setRole] = useState<Role>('MEMBER')
  const [invite, setInvite] = useState<Invite | null>(null)
  const createInvite = useCreateInvite(slug)

  // 后端返回 url 优先；否则用 token 拼前端 accept-invite 链接
  const inviteUrl = invite
    ? invite.url || `${window.location.origin}/accept-invite?token=${invite.token}`
    : ''

  function handleCreate() {
    createInvite.mutate(
      { role },
      { onSuccess: (data) => setInvite(data) },
    )
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>邀请成员</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          角色
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            style={{
              padding: '6px 8px',
              fontSize: 14,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg)',
              color: 'var(--text-h)',
            }}
          >
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </label>
        <button
          type="button"
          onClick={handleCreate}
          disabled={createInvite.isPending}
          style={{ ...buttonStyle, opacity: createInvite.isPending ? 0.6 : 1 }}
        >
          {createInvite.isPending ? '生成中…' : '生成邀请链接'}
        </button>
      </div>
      {createInvite.isError && (
        <p style={{ fontSize: 14, color: '#dc2626', marginTop: 10 }}>
          生成失败：{createInvite.error.message}
        </p>
      )}
      {invite && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--code-bg)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <code style={{ fontSize: 13, wordBreak: 'break-all', flex: 1, minWidth: 200 }}>
            {inviteUrl}
          </code>
          <CopyButton text={inviteUrl} />
          <span style={{ fontSize: 12, color: 'var(--text)' }}>
            有效期至 {new Date(invite.expiresAt).toLocaleString()}
          </span>
        </div>
      )}
    </section>
  )
}

/** 单个项目的 Sprint 设置行（每行独立 mutation，hooks 按 key 绑定） */
function ProjectSettingsRow({ slug, project }: { slug: string; project: Project }) {
  const update = useUpdateProject(slug, project.key)
  return (
    <tr>
      <td style={tdStyle}>
        <strong>{project.key}</strong>
        <span style={{ marginLeft: 8, color: 'var(--text)' }}>{project.name}</span>
      </td>
      <td style={tdStyle}>
        <select
          value={project.defaultSprintLength}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ defaultSprintLength: e.target.value as SprintLength })}
          style={{
            padding: '6px 8px',
            fontSize: 14,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text-h)',
          }}
        >
          {SPRINT_LENGTHS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={project.autoRotate}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ autoRotate: e.target.checked })}
          />
          <span style={{ fontSize: 13 }}>自动轮转</span>
        </label>
        {update.isError && (
          <span style={{ marginLeft: 8, fontSize: 12, color: '#dc2626' }}>
            保存失败：{update.error.message}
          </span>
        )}
      </td>
    </tr>
  )
}

/** 新建项目表单：key（2-6 大写字母）+ 名称 */
function CreateProjectForm({ slug }: { slug: string }) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const createProject = useCreateProject(slug)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!key.trim() || !name.trim() || createProject.isPending) return
    createProject.mutate(
      { key: key.trim().toUpperCase(), name: name.trim() },
      {
        onSuccess: () => {
          setKey('')
          setName('')
        },
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="Key（如 PM）"
          aria-label="项目 Key"
          pattern="[A-Z]{2,6}"
          title="2-6 个大写字母"
          required
          style={{
            width: 110,
            padding: '6px 10px',
            fontSize: 14,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text-h)',
          }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="项目名称"
          aria-label="项目名称"
          required
          style={{
            flex: 1,
            minWidth: 180,
            padding: '6px 10px',
            fontSize: 14,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text-h)',
          }}
        />
        <button
          type="submit"
          disabled={createProject.isPending}
          style={{ ...buttonStyle, opacity: createProject.isPending ? 0.6 : 1 }}
        >
          {createProject.isPending ? '创建中…' : '新建项目'}
        </button>
      </div>
      {createProject.isError && (
        <p style={{ fontSize: 13, color: '#dc2626', margin: '8px 0 0' }}>
          创建失败：{createProject.error.message}
        </p>
      )}
    </form>
  )
}

/** 项目 Sprint 默认设置 */
function ProjectsSection({ slug }: { slug: string }) {
  const projects = useProjects(slug)
  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>项目</h2>
      <CreateProjectForm slug={slug} />
      {projects.isLoading && <p style={{ fontSize: 14, color: 'var(--text)' }}>加载中…</p>}
      {projects.isError && (
        <p style={{ fontSize: 14, color: '#dc2626' }}>项目加载失败：{projects.error.message}</p>
      )}
      {projects.data && projects.data.length === 0 && (
        <p style={{ fontSize: 14, color: 'var(--text)' }}>暂无项目。</p>
      )}
      {projects.data && projects.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>项目</th>
              <th style={thStyle}>默认 Sprint 周期</th>
              <th style={thStyle}>自动轮转</th>
            </tr>
          </thead>
          <tbody>
            {projects.data.map((p) => (
              <ProjectSettingsRow key={p.id} slug={slug} project={p} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function TenantAdmin() {
  const { slug = '' } = useParams<{ slug: string }>()
  return (
    <div style={{ padding: 24, maxWidth: 880 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>租户管理 · {slug}</h1>
      <MembersSection slug={slug} />
      <InviteSection slug={slug} />
      <ProjectsSection slug={slug} />
    </div>
  )
}
