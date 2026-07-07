// All Sprints 页：所有 Sprint 倒序列表（ACTIVE/CLOSED/PLANNED），每个 Sprint 一个分组卡，
// 默认全部展开，点标题折叠。数据来自 GET /projects/{key}/sprints?withTasks=true。
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useCreateSprint, useProjects, useSprints, useStartSprint } from '../api/hooks'
import type { SprintStatus, SprintWithTasks, TaskBrief } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import TaskDrawer from '../components/TaskDrawer'
import TypeIcon from '../components/TypeIcon'

const SPRINT_STATUS_META: Record<SprintStatus, { label: string; bg: string; fg: string }> = {
  PLANNED: { label: 'Planned', bg: '#e5e7eb', fg: '#374151' },
  ACTIVE: { label: 'Active', bg: '#dbeafe', fg: '#1d4ed8' },
  CLOSED: { label: 'Closed', bg: '#f3e8ff', fg: '#7e22ce' },
}

function SprintStatusBadge({ status }: { status: SprintStatus }) {
  const meta = SPRINT_STATUS_META[status]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        background: meta.bg,
        color: meta.fg,
      }}
    >
      {meta.label}
    </span>
  )
}

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderTop: '1px solid #f3f4f6',
  fontSize: 13,
  color: '#111827',
  verticalAlign: 'middle',
}

const headCellStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

function TaskTable({
  tasks,
  onOpen,
}: {
  tasks: TaskBrief[]
  onOpen: (task: TaskBrief) => void
}) {
  if (tasks.length === 0) {
    return (
      <div style={{ padding: '12px 16px', fontSize: 13, color: '#9ca3af' }}>
        该 Sprint 暂无任务
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={headCellStyle}>#</th>
            <th style={headCellStyle}>类型</th>
            <th style={{ ...headCellStyle, width: '100%' }}>标题</th>
            <th style={headCellStyle}>状态</th>
            <th style={headCellStyle}>Points</th>
            <th style={headCellStyle}>负责人</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              onClick={() => onOpen(task)}
              role="button"
              style={{ cursor: 'pointer' }}
            >
              <td style={{ ...cellStyle, color: '#6b7280', whiteSpace: 'nowrap' }}>#{task.seq}</td>
              <td style={cellStyle}>
                <TypeIcon type={task.type} />
              </td>
              <td style={cellStyle}>{task.title}</td>
              <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                <StatusBadge status={task.status} />
              </td>
              <td style={{ ...cellStyle, whiteSpace: 'nowrap', textAlign: 'center' }}>
                {task.points ?? '—'}
              </td>
              <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                {task.assigneeName ?? <span style={{ color: '#9ca3af' }}>未指派</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SprintCard({
  sprint,
  collapsed,
  onToggle,
  onOpenTask,
  onStart,
  starting,
}: {
  sprint: SprintWithTasks
  collapsed: boolean
  onToggle: () => void
  onOpenTask: (task: TaskBrief) => void
  onStart?: () => void
  starting?: boolean
}) {
  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '10px 16px',
          background: '#f9fafb',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 12, color: '#6b7280', width: 12 }}>{collapsed ? '▸' : '▾'}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{sprint.name}</span>
        <SprintStatusBadge status={sprint.status} />
        <span style={{ fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
          {sprint.startDate} ~ {sprint.endDate}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>
          {sprint.tasks.length} 个任务
        </span>
        {sprint.status === 'PLANNED' && onStart && (
          <span
            role="button"
            aria-label={`启动 ${sprint.name}`}
            onClick={(e) => {
              e.stopPropagation()
              if (!starting) onStart()
            }}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: '#4f46e5',
              color: '#fff',
              whiteSpace: 'nowrap',
              opacity: starting ? 0.6 : 1,
            }}
          >
            {starting ? '启动中…' : '启动'}
          </span>
        )}
      </button>
      {!collapsed && <TaskTable tasks={sprint.tasks} onOpen={onOpenTask} />}
    </section>
  )
}

export default function AllSprints() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { data: projects, isLoading: projectsLoading } = useProjects(slug)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const projectKey = selectedKey ?? projects?.[0]?.key ?? ''

  const { data: sprints, isLoading, isError, error } = useSprints(slug, projectKey, true)
  const createSprint = useCreateSprint(slug, projectKey)
  const startSprint = useStartSprint(slug)

  // 默认全部展开：记录被折叠的 sprint id
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set())
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)
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

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>All Sprints</h1>
        {projects && projects.length > 1 && (
          <select
            value={projectKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            style={{ padding: '4px 8px', fontSize: 13 }}
          >
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}（{p.key}）
              </option>
            ))}
          </select>
        )}
        {projectKey && (
          <button
            type="button"
            onClick={() => createSprint.mutate({})}
            disabled={createSprint.isPending}
            style={{
              marginLeft: 'auto',
              padding: '6px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: createSprint.isPending ? 0.6 : 1,
            }}
          >
            {createSprint.isPending ? '创建中…' : '新建 Sprint'}
          </button>
        )}
      </div>
      {createSprint.isError && (
        <p style={{ color: '#dc2626', fontSize: 13 }}>
          创建失败：{createSprint.error instanceof Error ? createSprint.error.message : '未知错误'}
        </p>
      )}
      {startSprint.isError && (
        <p style={{ color: '#dc2626', fontSize: 13 }}>
          启动失败：{startSprint.error instanceof Error ? startSprint.error.message : '未知错误'}
        </p>
      )}

      {(projectsLoading || isLoading) && (
        <p style={{ color: '#6b7280', fontSize: 14 }}>加载中…</p>
      )}

      {!projectsLoading && projects && projects.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: 14 }}>暂无项目，请先创建项目。</p>
      )}

      {isError && (
        <p style={{ color: '#dc2626', fontSize: 14 }}>
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}

      {!isLoading && !isError && projectKey && sorted.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: 14 }}>该项目还没有任何 Sprint。</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sorted.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            collapsed={collapsedIds.has(sprint.id)}
            onToggle={() => toggle(sprint.id)}
            onOpenTask={setDrawerTask}
            onStart={() => startSprint.mutate(sprint.id)}
            starting={startSprint.isPending}
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
    </div>
  )
}
