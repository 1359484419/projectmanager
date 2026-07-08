// 租户管理（仅 ADMIN）：成员列表、生成邀请链接（复制）、项目默认 Sprint 周期与 auto_rotate 开关。
// 数据：GET /api/t/{slug}/members、POST /api/t/{slug}/invites、
//       GET /api/t/{slug}/projects、PATCH /api/t/{slug}/projects/{key}。
// 非 ADMIN 调用 members/invites 时后端按约定返回 404，页面据此展示无权限提示。
// 视觉真源：docs/design/mock/markup.html（ADMIN 节）+ logic.jsx（rotateToggle）。
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  useCreateInvite,
  useCreateProject,
  useMembers,
  useMyTenants,
  useProjects,
  useRemoveMember,
  useRenameTenant,
  useUpdateProject,
} from '../api/hooks'
import { ApiError, currentUserId } from '../api/client'
import {
  ConfirmDialog,
  Icon,
  SelectWrap,
  cardStyle,
  inputStyle,
  pageTitleStyle,
  selStyle,
  useToast,
} from '../components/ui'
import { Avatar } from '../components/TaskCard'
import type { Invite, Member, Project, Role, SprintLength } from '../api/types'

/** 移出成员 409 错误码 → 中文提示 */
const REMOVE_MEMBER_ERR: Record<string, string> = {
  CANNOT_REMOVE_SELF: '不能移出自己',
  LAST_ADMIN: '不能移出最后一位管理员',
}

const SPRINT_LENGTHS: { value: SprintLength; label: string }[] = [
  { value: 'WEEK_1', label: '1 周' },
  { value: 'WEEK_2', label: '2 周' },
  { value: 'MONTH_1', label: '1 个月' },
]

/** 卡片内小节标题（13px/600） */
const sectionTitleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }

/** 角色胶囊（设计稿成员行右侧 pill） */
function RolePill({ role }: { role: Role }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: 'var(--dim)',
        background: 'var(--card-2)',
        border: '1px solid var(--border-soft)',
        borderRadius: 20,
        padding: '2px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {role}
    </span>
  )
}

/** 滑动开关（照搬 logic.jsx rotateToggle：40x23 胶囊 + 17px 白色圆钮） */
function RotateToggle({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      onClick={() => {
        if (!disabled) onToggle()
      }}
      style={{
        width: 40,
        height: 23,
        borderRadius: 12,
        background: on ? 'var(--accent)' : 'var(--card-2)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        display: 'inline-flex',
        alignItems: 'center',
        padding: 2,
        transition: '.15s',
        justifyContent: on ? 'flex-end' : 'flex-start',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flex: 'none',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          width: 17,
          height: 17,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.3)',
        }}
      />
    </span>
  )
}

/** 成员行 skeleton（.sk shimmer） */
function MemberSkeleton() {
  return (
    <div style={{ padding: '6px 8px' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, height: 44, padding: '0 8px' }}>
          <span className="sk" style={{ width: 28, height: 28, borderRadius: '50%', flex: 'none' }} />
          <span className="sk" style={{ width: 70, height: 12 }} />
          <span className="sk" style={{ flex: 1, maxWidth: 220, height: 12 }} />
          <span className="sk" style={{ width: 56, height: 18, borderRadius: 20 }} />
        </div>
      ))}
    </div>
  )
}

/** 成员卡片：标题栏 + 生成邀请链接 + 成员列表 */
function MembersCard({ slug }: { slug: string }) {
  const toast = useToast()
  const members = useMembers(slug)
  const createInvite = useCreateInvite(slug)
  const removeMember = useRemoveMember(slug)
  const [invite, setInvite] = useState<Invite | null>(null)
  const [role, setRole] = useState<Role>('MEMBER')
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const me = currentUserId()

  function confirmRemove() {
    if (!removeTarget || removeMember.isPending) return
    const target = removeTarget
    removeMember.mutate(target.userId, {
      onSuccess: () => {
        setRemoveTarget(null)
        toast.show(`已将 ${target.displayName} 移出租户`)
      },
      onError: (err) => {
        setRemoveTarget(null)
        const msg =
          err instanceof ApiError && err.status === 409 && REMOVE_MEMBER_ERR[err.code]
            ? REMOVE_MEMBER_ERR[err.code]
            : `移出失败：${err.message}`
        toast.show(msg, 'info')
      },
    })
  }

  // 后端返回 url 优先；否则用 token 拼前端 accept-invite 链接
  const inviteUrl = invite
    ? invite.url || `${window.location.origin}/accept-invite?token=${invite.token}`
    : ''

  function handleGenerate() {
    if (createInvite.isPending) return
    createInvite.mutate(
      { role },
      {
        onSuccess: (data) => setInvite(data),
        onError: (err) => toast.show(`生成失败：${err.message}`, 'info'),
      },
    )
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast.show('邀请链接已复制')
    } catch {
      // clipboard API 不可用（如非 https）时退化为 prompt
      window.prompt('手动复制：', inviteUrl)
    }
  }

  const denied = members.isError && members.error instanceof ApiError && members.error.status === 404

  return (
    <div style={{ ...cardStyle, marginBottom: 16, overflow: 'hidden' }}>
      {/* 标题栏 */}
      <div
        style={{
          padding: '13px 16px',
          borderBottom: '1px solid var(--border-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={sectionTitleStyle}>成员</span>
        <span style={{ flex: 1 }} />
        {/* 角色选择（真实 API 需要 role 参数，设计稿之外的最小补充） */}
        <SelectWrap chevronTop={8} style={{ width: 104 }}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            aria-label="邀请角色"
            style={{ ...selStyle, height: 28, fontSize: 12 }}
          >
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </SelectWrap>
        <button
          type="button"
          onClick={handleGenerate}
          className="hover-card"
          style={{
            height: 28,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            fontSize: 12,
            cursor: 'pointer',
            opacity: createInvite.isPending ? 0.6 : 1,
          }}
        >
          {createInvite.isPending ? '生成中…' : '生成邀请链接'}
        </button>
      </div>

      {/* 邀请链接展示条 */}
      {invite && (
        <div
          style={{
            margin: '12px 16px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            borderRadius: 8,
            padding: '9px 12px',
          }}
        >
          <span
            title={inviteUrl}
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {inviteUrl}
          </span>
          <span style={{ fontSize: 11, color: 'var(--faint)', flex: 'none' }}>
            有效期至 {new Date(invite.expiresAt).toLocaleString()}
          </span>
          <button
            type="button"
            onClick={copyInvite}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 26,
              padding: '0 10px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 11.5,
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            <Icon name="copy" size={12} />
            复制
          </button>
        </div>
      )}

      {/* 成员列表 */}
      {members.isLoading && <MemberSkeleton />}
      {members.isError && (
        <div style={{ padding: '18px 16px', fontSize: 12.5, color: denied ? 'var(--faint)' : 'var(--type-bug)' }}>
          {denied ? '无权查看成员列表（仅 ADMIN 可访问本页）。' : `成员加载失败：${members.error.message}`}
        </div>
      )}
      {members.data && members.data.length === 0 && (
        <div style={{ padding: '18px 16px', fontSize: 12.5, color: 'var(--faint)' }}>暂无成员。</div>
      )}
      {members.data && members.data.length > 0 && (
        <div style={{ padding: '6px 8px' }}>
          {members.data.map((m) => (
            <div
              key={m.userId}
              style={{ display: 'flex', alignItems: 'center', gap: 11, height: 44, padding: '0 8px' }}
            >
              <Avatar name={m.displayName} size={28} />
              <span style={{ fontSize: 13, minWidth: 70 }}>{m.displayName}</span>
              <span
                style={{
                  fontSize: 12.5,
                  color: 'var(--dim)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.email}
              </span>
              <RolePill role={m.role} />
              {m.userId !== me && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(m)}
                  disabled={removeMember.isPending}
                  className="hover-card"
                  aria-label={`移出租户（${m.displayName}）`}
                  style={{
                    height: 26,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--type-bug)',
                    fontSize: 11.5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    opacity: removeMember.isPending ? 0.6 : 1,
                  }}
                >
                  移出租户
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={removeTarget != null}
        title={`将 ${removeTarget?.displayName ?? ''} 移出租户？`}
        message={
          <>
            移出后其未完成任务将转为<b>未指派</b>，其在本租户的 API 令牌将立即失效。
            该成员将无法再访问本租户，此操作不可撤销。
          </>
        }
        actionLabel="移出"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}

/** 单个项目的 Sprint 设置块（每个项目独立 mutation，hooks 按 key 绑定） */
function ProjectSettingsBlock({ slug, project, showDivider }: { slug: string; project: Project; showDivider: boolean }) {
  const toast = useToast()
  const update = useUpdateProject(slug, project.key)

  function save(patch: { defaultSprintLength?: SprintLength; autoRotate?: boolean }) {
    update.mutate(patch, {
      onSuccess: () => toast.show('项目设置已保存'),
      onError: (err) => toast.show(`保存失败：${err.message}`, 'info'),
    })
  }

  return (
    <div style={{ borderTop: showDivider ? '1px solid var(--border-soft)' : 'none', paddingTop: showDivider ? 14 : 0, marginTop: showDivider ? 14 : 0 }}>
      {/* 项目名行 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
          {project.key}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{project.name}</span>
      </div>
      {/* 默认 Sprint 周期 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 13, flex: 1 }}>
          默认 Sprint 周期
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>新建 Sprint 时的默认天数</div>
        </span>
        <SelectWrap chevronTop={9} style={{ width: 108 }}>
          <select
            value={project.defaultSprintLength}
            disabled={update.isPending}
            onChange={(e) => save({ defaultSprintLength: e.target.value as SprintLength })}
            aria-label={`${project.key} 默认 Sprint 周期`}
            style={{ ...selStyle, padding: '0 28px 0 11px' }}
          >
            {SPRINT_LENGTHS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </SelectWrap>
      </div>
      {/* Sprint 自动轮转 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, flex: 1 }}>
          Sprint 自动轮转
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>当前 Sprint 结束时自动创建下一个</div>
        </span>
        <RotateToggle
          on={project.autoRotate}
          disabled={update.isPending}
          onToggle={() => save({ autoRotate: !project.autoRotate })}
        />
      </div>
    </div>
  )
}

/** 新建项目表单：key（2-6 大写字母）+ 名称 */
function CreateProjectForm({ slug }: { slug: string }) {
  const toast = useToast()
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
          toast.show('项目已创建')
        },
        onError: (err) => toast.show(`创建失败：${err.message}`, 'info'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
      <input
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
        placeholder="Key（如 PM）"
        aria-label="项目 Key"
        pattern="[A-Z]{2,6}"
        title="2-6 个大写字母"
        required
        style={{ ...inputStyle, width: 110, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="项目名称"
        aria-label="项目名称"
        required
        style={{ ...inputStyle, flex: 1, minWidth: 180 }}
      />
      <button
        type="submit"
        disabled={createProject.isPending}
        className="btn-primary"
        style={{
          height: 30,
          padding: '0 12px',
          borderRadius: 7,
          border: 'none',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          opacity: createProject.isPending ? 0.6 : 1,
        }}
      >
        {createProject.isPending ? '创建中…' : '新建项目'}
      </button>
    </form>
  )
}

/** 项目设置卡片 */
function ProjectsCard({ slug }: { slug: string }) {
  const projects = useProjects(slug)
  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <div style={{ ...sectionTitleStyle, marginBottom: 14 }}>项目设置</div>
      <CreateProjectForm slug={slug} />
      {projects.isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="sk" style={{ width: '55%', height: 14 }} />
          <span className="sk" style={{ width: '80%', height: 30 }} />
          <span className="sk" style={{ width: '80%', height: 30 }} />
        </div>
      )}
      {projects.isError && (
        <div style={{ fontSize: 12.5, color: 'var(--type-bug)' }}>项目加载失败：{projects.error.message}</div>
      )}
      {projects.data && projects.data.length === 0 && (
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
          暂无项目
        </div>
      )}
      {projects.data?.map((p, i) => (
        <ProjectSettingsBlock key={p.id} slug={slug} project={p} showDivider={i > 0} />
      ))}
    </div>
  )
}

/** 租户名设置卡（仅 ADMIN 可改；改后顶栏同步） */
function TenantNameCard({ slug }: { slug: string }) {
  const toast = useToast()
  const tenants = useMyTenants()
  const current = tenants.data?.find((t) => t.slug === slug)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const value = dirty ? name : (current?.name ?? '')
  const rename = useRenameTenant(slug)

  function save() {
    const v = value.trim()
    if (!v || v === current?.name || rename.isPending) return
    rename.mutate(v, {
      onSuccess: () => {
        setDirty(false)
        toast.show('租户名已保存')
      },
      onError: (err) => toast.show(`保存失败：${(err as Error).message}`, 'info'),
    })
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 16, padding: '14px 16px' }}>
      <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 10 }}>租户名</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={value}
          onChange={(e) => {
            setDirty(true)
            setName(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
          placeholder="团队/租户名"
          maxLength={80}
          style={{ ...inputStyle, maxWidth: 320 }}
        />
        <button
          type="button"
          onClick={save}
          disabled={!value.trim() || value.trim() === current?.name || rename.isPending}
          className="btn-primary"
          style={{
            height: 32,
            padding: '0 16px',
            borderRadius: 7,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: !value.trim() || value.trim() === current?.name || rename.isPending ? 0.5 : 1,
          }}
        >
          {rename.isPending ? '保存中…' : '保存'}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '8px 0 0' }}>
        仅管理员可修改；租户地址（slug「{slug}」）不可更改。
      </p>
    </div>
  )
}

export default function TenantAdmin() {
  const { slug = '' } = useParams<{ slug: string }>()
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      <div style={{ maxWidth: 820 }}>
        <h1 style={{ ...pageTitleStyle, margin: '0 0 18px' }}>租户管理</h1>
        <TenantNameCard slug={slug} />
        <MembersCard slug={slug} />
        <ProjectsCard slug={slug} />
      </div>
    </div>
  )
}
