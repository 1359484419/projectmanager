import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useBacklog, useCreateTask, useProjects, useSprints, useUpdateTask } from '../api/hooks'
import type { Sprint, Task, TaskBrief, TaskType } from '../api/types'
import TaskCard from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'
import TypeIcon from '../components/TypeIcon'

const TYPE_FILTERS: Array<{ value: TaskType | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'STORY', label: 'Story' },
  { value: 'BUG', label: 'Bug' },
  { value: 'TASK', label: 'Task' },
]

/** 当前（ACTIVE）与下个（startDate 最早的 PLANNED）Sprint */
function pickCurrentAndNext(sprints: Sprint[] | undefined): {
  current: Sprint | null
  next: Sprint | null
} {
  if (!sprints) return { current: null, next: null }
  const current = sprints.find((s) => s.status === 'ACTIVE') ?? null
  const next =
    sprints
      .filter((s) => s.status === 'PLANNED')
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
  return { current, next }
}

/** 顶部快速创建行：type / title / points */
function QuickCreateRow({ slug, projectKey }: { slug: string; projectKey: string }) {
  const [type, setType] = useState<TaskType>('STORY')
  const [title, setTitle] = useState('')
  const [points, setPoints] = useState('')
  const createTask = useCreateTask(slug, projectKey)

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || createTask.isPending) return
    const parsedPoints = Number.parseInt(points, 10)
    createTask.mutate(
      {
        type,
        title: trimmed,
        ...(Number.isInteger(parsedPoints) && parsedPoints > 0 ? { points: parsedPoints } : {}),
      },
      {
        onSuccess: () => {
          setTitle('')
          setPoints('')
        },
      },
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          border: '1px dashed #d1d5db',
          borderRadius: 8,
          background: '#f9fafb',
        }}
      >
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TaskType)}
          aria-label="任务类型"
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="STORY">Story</option>
          <option value="BUG">Bug</option>
          <option value="TASK">Task</option>
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="快速创建：输入任务标题…"
          aria-label="任务标题"
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            fontSize: 14,
          }}
        />
        <input
          value={points}
          onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="points"
          aria-label="points"
          inputMode="numeric"
          style={{
            width: 72,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={!title.trim() || createTask.isPending}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#4f46e5',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: !title.trim() || createTask.isPending ? 0.5 : 1,
          }}
        >
          {createTask.isPending ? '创建中…' : '创建'}
        </button>
      </form>
      {createTask.isError && (
        <div style={{ color: '#dc2626', fontSize: 12 }}>
          创建失败：{createTask.error instanceof Error ? createTask.error.message : '未知错误'}
        </div>
      )}
    </div>
  )
}

/** 单行任务：TaskCard + 「移入 Sprint」菜单 */
function BacklogRow({
  slug,
  projectKey,
  task,
  current,
  next,
  onOpen,
}: {
  slug: string
  projectKey: string
  task: Task
  current: Sprint | null
  next: Sprint | null
  onOpen: (task: TaskBrief) => void
}) {
  const updateTask = useUpdateTask(slug)
  const hasTarget = current != null || next != null

  const moveTo = (sprintId: number) => {
    if (updateTask.isPending) return
    updateTask.mutate({ id: task.id, sprintId })
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TaskCard task={task} projectKey={projectKey} onClick={onOpen} />
      </div>
      <select
        value=""
        disabled={!hasTarget || updateTask.isPending}
        onChange={(e) => {
          const id = Number(e.target.value)
          if (id) moveTo(id)
        }}
        aria-label={`移入 Sprint（${projectKey}-${task.seq}）`}
        title={hasTarget ? '移入 Sprint' : '没有可移入的 Sprint'}
        style={{
          width: 140,
          padding: '0 8px',
          borderRadius: 8,
          border: '1px solid #d1d5db',
          background: '#fff',
          fontSize: 13,
          cursor: hasTarget ? 'pointer' : 'not-allowed',
          color: hasTarget ? '#374151' : '#9ca3af',
        }}
      >
        <option value="" disabled>
          {updateTask.isPending ? '移入中…' : '移入 Sprint…'}
        </option>
        {current && <option value={current.id}>当前：{current.name}</option>}
        {next && <option value={next.id}>下个：{next.name}</option>}
      </select>
    </div>
  )
}

export default function Backlog() {
  const { slug = '' } = useParams<{ slug: string }>()
  const projectsQuery = useProjects(slug)
  const projects = projectsQuery.data
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const activeKey = projectKey ?? projects?.[0]?.key ?? ''

  const backlogQuery = useBacklog(slug, activeKey)
  const sprintsQuery = useSprints(slug, activeKey)
  const { current, next } = pickCurrentAndNext(sprintsQuery.data as Sprint[] | undefined)

  const [typeFilter, setTypeFilter] = useState<TaskType | 'ALL'>('ALL')
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)

  // rank 序（后端已按 rank 返回，前端再稳定排序一次防御）
  const tasks = useMemo(() => {
    const list = backlogQuery.data ?? []
    const filtered = typeFilter === 'ALL' ? list : list.filter((t) => t.type === typeFilter)
    return [...filtered].sort((a, b) => a.rank.localeCompare(b.rank))
  }, [backlogQuery.data, typeFilter])

  if (projectsQuery.isLoading) {
    return <div style={{ padding: 24, color: '#6b7280' }}>加载项目中…</div>
  }
  if (projectsQuery.isError) {
    return <div style={{ padding: 24, color: '#dc2626' }}>项目加载失败，请刷新重试。</div>
  }
  if (!projects || projects.length === 0) {
    return (
      <div style={{ padding: 24, color: '#6b7280' }}>
        还没有项目。请先在租户管理中创建项目。
      </div>
    )
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Backlog</h1>
        {projects.length > 1 && (
          <select
            value={activeKey}
            onChange={(e) => setProjectKey(e.target.value)}
            aria-label="选择项目"
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 9999,
                border: '1px solid',
                borderColor: typeFilter === f.value ? '#4f46e5' : '#d1d5db',
                background: typeFilter === f.value ? '#eef2ff' : '#fff',
                color: typeFilter === f.value ? '#4f46e5' : '#374151',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {f.value !== 'ALL' && <TypeIcon type={f.value} size={14} />}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <QuickCreateRow slug={slug} projectKey={activeKey} />

      {backlogQuery.isLoading && <div style={{ color: '#6b7280' }}>加载任务中…</div>}
      {backlogQuery.isError && (
        <div style={{ color: '#dc2626' }}>Backlog 加载失败，请刷新重试。</div>
      )}
      {backlogQuery.isSuccess && tasks.length === 0 && (
        <div
          style={{
            padding: '32px 0',
            textAlign: 'center',
            color: '#9ca3af',
            border: '1px dashed #e5e7eb',
            borderRadius: 8,
          }}
        >
          {typeFilter === 'ALL'
            ? 'Backlog 是空的，用上面的快速创建行添加第一个任务吧。'
            : '该类型下没有任务。'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map((task) => (
          <BacklogRow
            key={task.id}
            slug={slug}
            projectKey={activeKey}
            task={task}
            current={current}
            next={next}
            onOpen={setDrawerTask}
          />
        ))}
      </div>
      {drawerTask && (
        <TaskDrawer
          slug={slug}
          projectKey={activeKey}
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
        />
      )}
    </div>
  )
}
