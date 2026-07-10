// Backlog 页 —— 视觉真源：docs/design/mock/markup.html「===== BACKLOG =====」节 + logic.jsx
// 结构：标题行（Backlog · N 项 · 筛选胶囊组）→ 卡片容器（快速创建行 + 紧凑任务行列表）
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useBacklog, useCreateTask, useProjects, useSprints, useUpdateTask } from '../api/hooks'
import type { Sprint, Task, TaskBrief, TaskType } from '../api/types'
import AssigneeFilterCompact from '../components/AssigneeFilterCompact'
import TaskCard from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'
import { Icon, SelectWrap, useToast } from '../components/ui'
import { taskMatchesFilter, useAssigneeFilter } from '../state/assigneeFilter'
import { resolveProjectKey, setSelectedProjectKey, useSelectedProjectKey } from '../state/selectedProject'
import { POINTS_MAX, POINTS_MIN, POINTS_STEP, parsePointsInput } from '../utils/points'
import { useT } from '../i18n'

const TYPE_FILTER_KEYS = [
  { value: 'ALL' as const, key: 'filterAll' as const },
  { value: 'STORY' as const, key: 'typeStory' as const },
  { value: 'BUG' as const, key: 'typeBug' as const },
  { value: 'TASK' as const, key: 'typeTask' as const },
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

/** 快速创建行（卡片容器头部）：类型下拉 + 标题 + points + 添加，回车提交 */
function QuickCreateRow({ slug, projectKey }: { slug: string; projectKey: string }) {
  const [type, setType] = useState<TaskType>('STORY')
  const [title, setTitle] = useState('')
  const [points, setPoints] = useState('')
  const createTask = useCreateTask(slug, projectKey)
  const toast = useToast()
  const t = useT()

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || createTask.isPending) return
    // 估点 0.5-5（0.5 步进）：非法输入即时拒绝，不发请求
    const parsedPoints = parsePointsInput(points)
    if (parsedPoints === undefined) {
      toast.show(t.pointsRangeMsg, 'info')
      return
    }
    createTask.mutate(
      {
        type,
        title: trimmed,
        ...(parsedPoints != null ? { points: parsedPoints } : {}),
      },
      {
        onSuccess: (created) => {
          setTitle('')
          setPoints('')
          toast.show(t.taskCreated(projectKey + '-' + created.seq))
        },
        onError: (err) =>
          toast.show(t.createFailed(err instanceof Error ? err.message : t.unknownError), 'info'),
      },
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 46,
        padding: '0 12px',
        borderBottom: '1px solid var(--border-soft)',
        background: 'var(--card-2)',
      }}
    >
      <SelectWrap chevronTop={8} style={{ flex: 'none' }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TaskType)}
          aria-label={t.taskType}
          style={{
            height: 28,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--text)',
            fontSize: 12,
            padding: '0 26px 0 9px',
            cursor: 'pointer',
            appearance: 'none',
          }}
        >
          <option value="STORY">{t.typeStory}</option>
          <option value="BUG">{t.typeBug}</option>
          <option value="TASK">{t.typeTask}</option>
        </select>
      </SelectWrap>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t.quickCreatePlaceholder}
        aria-label={t.taskTitle}
        style={{
          flex: 1,
          height: 28,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontSize: 13,
          minWidth: 0,
        }}
      />
      <input
        type="number"
        min={POINTS_MIN}
        max={POINTS_MAX}
        step={POINTS_STEP}
        value={points}
        onChange={(e) => setPoints(e.target.value)}
        onBlur={() => {
          // 输入完成即时校验：非法值立刻提示（提交前的第一道拦截）
          if (points !== '' && parsePointsInput(points) === undefined) {
            toast.show(t.pointsRangeMsg, 'info')
          }
        }}
        placeholder="pts"
        aria-label="points"
        inputMode="decimal"
        style={{
          width: 52,
          height: 28,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--card)',
          color: 'var(--text)',
          fontSize: 12,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={!title.trim() || createTask.isPending}
        className="btn-primary"
        style={{
          height: 28,
          padding: '0 12px',
          borderRadius: 6,
          border: 'none',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          opacity: !title.trim() || createTask.isPending ? 0.55 : 1,
        }}
      >
        {t.add}
      </button>
    </form>
  )
}

/** 单行任务：TaskCard(row) + 「移入 Sprint」按钮（目标 = 当前 ACTIVE，其次下个 PLANNED） */
function BacklogRow({
  slug,
  projectKey,
  task,
  current,
  next,
  unassignedTag,
  onOpen,
}: {
  slug: string
  projectKey: string
  task: Task
  current: Sprint | null
  next: Sprint | null
  unassignedTag?: boolean
  onOpen: (task: TaskBrief) => void
}) {
  const updateTask = useUpdateTask(slug)
  const toast = useToast()
  const t = useT()
  const target = current ?? next

  const moveToSprint = () => {
    if (!target || updateTask.isPending) return
    updateTask.mutate(
      { id: task.id, sprintId: target.id },
      {
        onSuccess: () => toast.show(t.movedToSprint(projectKey + '-' + task.seq, target.name)),
        onError: (err) =>
          toast.show(t.moveFailed(err instanceof Error ? err.message : t.unknownError), 'info'),
      },
    )
  }

  return (
    <div className="task-row" style={{ display: 'flex', alignItems: 'center', borderRadius: 7 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TaskCard
          task={task}
          projectKey={projectKey}
          variant="row"
          unassignedTag={unassignedTag}
          onClick={onOpen}
        />
      </div>
      <button
        onClick={moveToSprint}
        disabled={!target || updateTask.isPending}
        className={target ? 'hover-accent' : undefined}
        title={target ? t.moveToSprintTarget(target.name) : t.noSprintToMove}
        aria-label={t.moveToSprintAria(projectKey + '-' + task.seq)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 26,
          marginRight: 10,
          padding: '0 9px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: target ? 'var(--dim)' : 'var(--faint)',
          fontSize: 11.5,
          cursor: target ? 'pointer' : 'not-allowed',
          whiteSpace: 'nowrap',
          flex: 'none',
          transition: '.1s',
        }}
      >
        {t.moveToSprint}
        <Icon name="arrowRight" size={12} style={{ display: 'flex' }} />
      </button>
    </div>
  )
}

/** 加载骨架：标题行 + 卡片容器内 6 条 38px 行（.sk shimmer） */
function BacklogSkeleton() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div className="sk" style={{ width: 120, height: 22 }} />
        <span style={{ flex: 1 }} />
        <div className="sk" style={{ width: 220, height: 28 }} />
      </div>
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: 46,
            borderBottom: '1px solid var(--border-soft)',
            background: 'var(--card-2)',
          }}
        />
        <div style={{ padding: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="sk" style={{ height: 38 }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ padding: 34, textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>
      {text}
    </div>
  )
}

export default function Backlog() {
  const t = useT()
  const { slug = '' } = useParams<{ slug: string }>()
  const projectsQuery = useProjects(slug)
  const projects = projectsQuery.data
  // 与顶栏项目切换器共享的选中项目（localStorage 按租户记忆）
  const storedProjectKey = useSelectedProjectKey(slug)
  const activeKey = resolveProjectKey(null, storedProjectKey, projects)

  const backlogQuery = useBacklog(slug, activeKey)
  const sprintsQuery = useSprints(slug, activeKey)
  const { current, next } = pickCurrentAndNext(sprintsQuery.data as Sprint[] | undefined)

  const [typeFilter, setTypeFilter] = useState<TaskType | 'ALL'>('ALL')
  const [assigneeFilter] = useAssigneeFilter()
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)

  // rank 序（后端已按 rank 返回，前端再稳定排序一次防御）
  const tasks = useMemo(() => {
    const list = backlogQuery.data ?? []
    const filtered = list.filter(
      (t) =>
        (typeFilter === 'ALL' || t.type === typeFilter) &&
        taskMatchesFilter(t.assigneeId, assigneeFilter),
    )
    return [...filtered].sort((a, b) => a.rank.localeCompare(b.rank))
  }, [backlogQuery.data, typeFilter, assigneeFilter])

  const backlogTotal = backlogQuery.data?.length ?? 0

  if (projectsQuery.isLoading) return <BacklogSkeleton />
  if (projectsQuery.isError) {
    return (
      <div style={{ flex: 1, padding: '20px 24px', fontSize: 13, color: 'var(--dim)' }}>
        {t.projectLoadFailed}
      </div>
    )
  }
  if (!projects || projects.length === 0) {
    return (
      <div style={{ flex: 1, padding: '20px 24px', fontSize: 13, color: 'var(--faint)' }}>
        {t.noProjectsYet}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      {/* 标题行：Backlog · N 项 · [项目切换] · 筛选胶囊组 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Backlog</h1>
        <span style={{ fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
          {t.nItems(backlogTotal)}
        </span>
        {projects.length > 1 && (
          <SelectWrap chevronTop={8} style={{ flex: 'none' }}>
            <select
              value={activeKey}
              onChange={(e) => setSelectedProjectKey(slug, e.target.value)}
              aria-label={t.selectProject}
              style={{
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--text)',
                fontSize: 12,
                padding: '0 26px 0 9px',
                cursor: 'pointer',
                appearance: 'none',
              }}
            >
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          </SelectWrap>
        )}
        <span style={{ flex: 1 }} />
        <AssigneeFilterCompact slug={slug} />
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 3,
          }}
        >
          {TYPE_FILTER_KEYS.map((f) => {
            const on = typeFilter === f.value
            return (
              <span
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                role="button"
                style={{
                  padding: '4px 11px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: '.1s',
                  ...(on
                    ? { background: 'var(--accent)', color: '#fff', fontWeight: 600 }
                    : { color: 'var(--dim)' }),
                }}
              >
                {t[f.key]}
              </span>
            )
          })}
        </div>
      </div>

      {/* 卡片容器：快速创建行 + 任务行列表 */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <QuickCreateRow slug={slug} projectKey={activeKey} />
        <div style={{ padding: 5 }}>
          {backlogQuery.isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="sk" style={{ height: 38 }} />
              ))}
            </div>
          )}
          {backlogQuery.isError && <EmptyHint text={t.backlogLoadFailed} />}
          {backlogQuery.isSuccess &&
            tasks.length === 0 &&
            (backlogTotal === 0 ? (
              <EmptyHint text={t.backlogEmpty} />
            ) : (
              <EmptyHint text={t.noFilterResults} />
            ))}
          {tasks.map((task) => (
            <BacklogRow
              key={task.id}
              slug={slug}
              projectKey={activeKey}
              task={task}
              current={current}
              next={next}
              unassignedTag={assigneeFilter === 'me'}
              onOpen={setDrawerTask}
            />
          ))}
        </div>
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
