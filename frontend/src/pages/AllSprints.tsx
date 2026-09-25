// All Sprints 页：所有 Sprint 倒序列表（ACTIVE/CLOSED/PLANNED），每个 Sprint 一个分组卡，
// 默认全部展开，点标题折叠。数据来自 GET /projects/{key}/sprints?withTasks=true。
// 视觉真源：docs/design/mock/markup.html「SPRINTS」节 + logic.jsx sprintGroups 徽标算法。
import { apiErrorMessage } from '../api/errors'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  useCloseSprint,
  useDeleteSprint,
  useMyTenants,
  useProjects,
  useSprints,
  useStartSprint,
} from '../api/hooks'
import type { SprintStatus, SprintWithTasks, TaskBrief } from '../api/types'
import TaskCard from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'
import CreateSprintDialog from '../components/CreateSprintDialog'
import NoProjectEmpty from '../components/NoProjectEmpty'
import { Icon } from '../components/icons'
import {
  Badge,
  ConfirmDialog,
  SelectWrap,
  btnSecondary,
  cardStyle,
  pageTitleStyle,
  selStyle,
  useToast,
} from '../components/ui'
import { useT } from '../i18n'
import { resolveProjectKey, setSelectedProjectKey, useSelectedProjectKey } from '../state/selectedProject'
import { canManageTenant } from '../state/tenantRole'
import { fmtPoints } from '../utils/points'
import { activeSprintBlocking } from '../utils/sprints'

/** Sprint 状态徽标（同 logic.jsx smap）：ACTIVE 带 pulse 呼吸点，PLANNED 灰，CLOSED 淡 */
function SprintStatusBadge({ status }: { status: SprintStatus }) {
  const t = useT()
  if (status === 'ACTIVE') {
    return (
      <Badge color="var(--prog)" soft="var(--prog-soft)">
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--prog)',
            animation: 'pulse 1.6s infinite',
          }}
        />
        {t.sprintInProgress}
      </Badge>
    )
  }
  if (status === 'PLANNED') return <Badge color="var(--todo)">{t.sprintNotStarted}</Badge>
  return <Badge color="var(--faint)">{t.sprintEnded}</Badge>
}

/** 日期区间：'2026-07-01' → '07-01 → 07-14'（设计稿 sp.dates，JetBrains Mono） */
function fmtDates(start: string, end: string): string {
  return `${start.slice(5)} → ${end.slice(5)}`
}

function SprintCard({
  sprint,
  projectKey,
  collapsed,
  onToggle,
  onOpenTask,
  onStart,
  onClose,
  onDelete,
  busy,
  canManage,
}: {
  sprint: SprintWithTasks
  projectKey: string
  collapsed: boolean
  onToggle: () => void
  onOpenTask: (task: TaskBrief) => void
  onStart: () => void
  onClose: () => void
  onDelete: () => void
  busy: boolean
  /** 启动/关闭/删除迭代是 ADMIN 权限（后端 @RequireRole → 403）：MEMBER 不渲染这些控件，而不是点了才报错 */
  canManage: boolean
}) {
  const t = useT()
  const points = sprint.tasks.reduce((sum, tk) => sum + (tk.points ?? 0), 0)
  return (
    <section style={{ ...cardStyle, overflow: 'hidden' }}>
      {/* 分组卡头：badge · 名称 · 日期 · 统计 ·（启动/关闭）——点击折叠/展开 */}
      <div
        onClick={onToggle}
        role="button"
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '13px 16px',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-soft)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Icon
          name="chevron"
          size={12}
          style={{
            color: 'var(--faint)',
            flex: 'none',
            transform: collapsed ? 'rotate(-90deg)' : 'none',
            transition: 'transform .12s',
          }}
        />
        <SprintStatusBadge status={sprint.status} />
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{sprint.name}</span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--faint)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtDates(sprint.startDate, sprint.endDate)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
          {t.nTasks(sprint.tasks.length)} · {fmtPoints(points)} {t.ptsUnit}
        </span>
        <span style={{ flex: 1 }} />
        {canManage && sprint.status === 'PLANNED' && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              onStart()
            }}
            style={{
              height: 27,
              padding: '0 12px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
              flex: 'none',
            }}
          >
            {t.startSprint}
          </button>
        )}
        {canManage && sprint.status === 'ACTIVE' && (
          <button
            type="button"
            className="hover-card"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            style={{
              height: 27,
              padding: '0 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
              fontSize: 12,
              fontWeight: 550,
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
              flex: 'none',
            }}
          >
            {t.closeSprint}
          </button>
        )}
        {canManage && sprint.status !== 'ACTIVE' && (
          <button
            type="button"
            className="hover-card"
            aria-label={t.deleteSprint}
            title={t.deleteSprint}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            style={{
              height: 27,
              width: 27,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--faint)',
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
              flex: 'none',
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
      {/* 任务行列表（TaskCard row 形态，~38px/行） */}
      {!collapsed && (
        <div style={{ padding: '4px 6px' }}>
          {sprint.tasks.length === 0 ? (
            <div style={{ padding: '10px 9px', fontSize: 12.5, color: 'var(--faint)' }}>
              {t.noSprintTasks}
            </div>
          ) : (
            sprint.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                projectKey={projectKey}
                variant="row"
                onClick={onOpenTask}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}

/** 加载骨架：仿分组卡形态的 .sk shimmer */
function SprintsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[0, 1].map((i) => (
        <div key={i} style={{ ...cardStyle, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '13px 16px',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            <span className="sk" style={{ width: 64, height: 20, borderRadius: 20 }} />
            <span className="sk" style={{ width: 90, height: 16 }} />
            <span className="sk" style={{ width: 120, height: 14 }} />
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[0, 1, 2].map((j) => (
              <span key={j} className="sk" style={{ height: 24 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

type ConfirmState = { kind: 'start' | 'close' | 'delete'; sprint: SprintWithTasks } | null

export default function AllSprints() {
  const { slug = '' } = useParams<{ slug: string }>()
  const toast = useToast()
  const t = useT()
  const { data: projects, isLoading: projectsLoading } = useProjects(slug)
  // 角色来自 /api/me/tenants（与 Layout 共享缓存）：迭代 启动/关闭/删除 只对 ADMIN 显示（审查 2026-09-25 #3）
  const { data: tenants } = useMyTenants()
  const canManage = canManageTenant(tenants?.find((x) => x.slug === slug)?.role)
  // 与顶栏项目切换器共享的选中项目（localStorage 按租户记忆）
  const storedProjectKey = useSelectedProjectKey(slug)
  const projectKey = resolveProjectKey(null, storedProjectKey, projects)

  const { data: sprints, isLoading, isError, error } = useSprints(slug, projectKey, true)
  const startSprint = useStartSprint(slug)
  const closeSprint = useCloseSprint(slug)
  const deleteSprint = useDeleteSprint(slug)

  // 默认全部展开：记录被折叠的 sprint id
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set())
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const toggle = (id: number) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 倒序：最新（startDate 最大）在前
  const sorted = useMemo(() => {
    const list = (sprints ?? []) as SprintWithTasks[]
    return [...list].sort(
      (a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id,
    )
  }, [sprints])

  // 启动前置：后端同项目只允许一个进行中的迭代（409 ACTIVE_SPRINT_EXISTS），确认框提前告知并禁用启动
  const blocking = confirm?.kind === 'start' ? activeSprintBlocking(sorted, confirm.sprint.id) : null

  const handleConfirm = () => {
    if (!confirm) return
    const { kind, sprint } = confirm
    if (kind === 'start' && blocking) return
    setConfirm(null)
    if (kind === 'start') {
      startSprint.mutate(sprint.id, {
        onSuccess: () => toast.show(t.sprintStarted),
        onError: (e) => toast.show(t.startFailed(apiErrorMessage(e, t)), 'info'),
      })
    } else if (kind === 'close') {
      closeSprint.mutate(
        { sprintId: sprint.id, unfinished: 'BACKLOG' },
        {
          onSuccess: () => toast.show(t.sprintClosed),
          onError: (e) => toast.show(t.closeFailed(apiErrorMessage(e, t)), 'info'),
        },
      )
    } else {
      deleteSprint.mutate(sprint.id, {
        onSuccess: () => toast.show(t.sprintDeleted),
        onError: (e) => toast.show(t.deleteSprintFailed(apiErrorMessage(e, t)), 'info'),
      })
    }
  }

  const busy = startSprint.isPending || closeSprint.isPending || deleteSprint.isPending

  return (
    <div className="page-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      {/* 页头：标题 · 项目切换 · 新建 Sprint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={pageTitleStyle}>{t.allSprints}</h1>
        {projects && projects.length > 1 && (
          <SelectWrap chevronTop={9}>
            <select
              value={projectKey}
              onChange={(e) => setSelectedProjectKey(slug, e.target.value)}
              aria-label={t.switchProject}
              style={{ ...selStyle, width: 'auto', background: 'var(--card)' }}
            >
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}（{p.key}）
                </option>
              ))}
            </select>
          </SelectWrap>
        )}
        <span style={{ flex: 1 }} />
        {projectKey && (
          <button
            type="button"
            className="hover-card"
            onClick={() => setCreateOpen(true)}
            style={{ ...btnSecondary, padding: '0 12px 0 9px' }}
          >
            <Icon name="plus" size={14} />
            {t.createSprint}
          </button>
        )}
      </div>

      {(projectsLoading || isLoading) && <SprintsSkeleton />}

      {!projectsLoading && projects && projects.length === 0 && <NoProjectEmpty slug={slug} />}

      {isError && (
        <div style={{ fontSize: 13, color: 'var(--type-bug)' }}>
          {t.sprintsLoadFailed(apiErrorMessage(error, t))}
        </div>
      )}

      {!isLoading && !isError && projectKey && sorted.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}>
          {t.noSprintsYet}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sorted.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            projectKey={projectKey}
            collapsed={collapsedIds.has(sprint.id)}
            onToggle={() => toggle(sprint.id)}
            onOpenTask={setDrawerTask}
            onStart={() => setConfirm({ kind: 'start', sprint })}
            onClose={() => setConfirm({ kind: 'close', sprint })}
            onDelete={() => setConfirm({ kind: 'delete', sprint })}
            busy={busy}
            canManage={canManage}
          />
        ))}
      </div>

      {drawerTask && (
        <TaskDrawer
          slug={slug}
          projectKey={projectKey}
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
        />
      )}

      {createOpen && projectKey && (
        <CreateSprintDialog slug={slug} projectKey={projectKey} onClose={() => setCreateOpen(false)} />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === 'close'
            ? t.confirmCloseSprint
            : confirm?.kind === 'delete'
              ? t.deleteSprintConfirm(confirm.sprint.name)
              : t.confirmStartSprint
        }
        message={
          confirm?.kind === 'close'
            ? t.closeSprintHint
            : confirm?.kind === 'delete'
              ? t.deleteSprintWarning
              : blocking
                ? t.startSprintBlocked(blocking.name)
                : t.startSprintHint
        }
        confirmDisabled={blocking != null}
        actionLabel={
          confirm?.kind === 'close'
            ? t.closeSprint
            : confirm?.kind === 'delete'
              ? t.deleteSprint
              : t.startSprint
        }
        danger={confirm?.kind === 'close' || confirm?.kind === 'delete'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
