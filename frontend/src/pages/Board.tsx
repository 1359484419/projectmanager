// Sprint 看板：TODO / IN_PROGRESS / COMPLETED / DONE 四列，dnd-kit 拖拽改状态（乐观更新，失败回滚）
// 视觉真源：docs/design/mock/markup.html（BOARD 节）+ logic.jsx（boardColumns 列样式）
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { api, currentUserId } from '../api/client'
import { qk, useBoard, useMembers, useProjects, useSprints } from '../api/hooks'
import type { Board as BoardData, TaskBrief, TaskStatus } from '../api/types'
import TaskCard, { Avatar } from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'
import { STATUS_LABEL, STATUS_VAR, useToast } from '../components/ui'
import { taskMatchesFilter, useAssigneeFilter } from '../state/assigneeFilter'

// 设计稿列定义：色点用状态 CSS 变量（var(--todo)/--prog/--comp/--done）
const COLUMNS: { status: TaskStatus; label: string; dot: string }[] = (
  ['TODO', 'IN_PROGRESS', 'COMPLETED', 'DONE'] as TaskStatus[]
).map((status) => ({
  status,
  label: STATUS_LABEL[status],
  dot: `var(--${STATUS_VAR[status]})`,
}))

const EMPTY_COLUMNS: Record<TaskStatus, TaskBrief[]> = {
  TODO: [],
  IN_PROGRESS: [],
  COMPLETED: [],
  DONE: [],
}

function DraggableCard({
  task,
  projectKey,
  unassignedTag,
  onOpen,
}: {
  task: TaskBrief
  projectKey?: string
  unassignedTag?: boolean
  onOpen: (task: TaskBrief) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.35 : 1, touchAction: 'none', cursor: 'grab' }}
    >
      {/* PointerSensor distance=4：原地点击不会触发拖拽，click 正常冒泡开抽屉 */}
      <TaskCard
        task={task}
        projectKey={projectKey}
        showStatus={false}
        unassignedTag={unassignedTag}
        onClick={onOpen}
      />
    </div>
  )
}

/** 顶部成员筛选行：「全部」胶囊 + 每成员 Avatar（自己排最前，点自己 = 只看我的）+ 任务数徽标 */
function AssigneeFilterRow({
  slug,
  columns,
}: {
  slug: string
  columns: Record<TaskStatus, TaskBrief[]>
}) {
  const members = useMembers(slug)
  const [filter, setFilter] = useAssigneeFilter()
  const me = currentUserId()

  const all = useMemo(() => Object.values(columns).flat(), [columns])
  // 自己排最前：「只看我的」即点自己头像
  const sorted = useMemo(() => {
    const list = members.data ?? []
    return [...list].sort((a, b) => Number(b.userId === me) - Number(a.userId === me))
  }, [members.data, me])

  if (sorted.length === 0) return null

  const allOn = filter === 'all'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 20px 12px',
        flexWrap: 'wrap',
        flex: 'none',
      }}
    >
      <span
        role="button"
        aria-pressed={allOn}
        onClick={() => setFilter('all')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 20,
          fontSize: 12,
          cursor: 'pointer',
          border: `1px solid ${allOn ? 'var(--accent)' : 'var(--border)'}`,
          background: allOn ? 'var(--accent)' : 'var(--card)',
          color: allOn ? '#fff' : 'var(--dim)',
          fontWeight: allOn ? 600 : 450,
          transition: '.1s',
        }}
      >
        全部
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{all.length}</span>
      </span>
      {sorted.map((m) => {
        const isMe = m.userId === me
        const on = isMe ? filter === 'me' : filter === m.userId
        const count = all.filter((t) => t.assigneeId === m.userId).length
        return (
          <span
            key={m.userId}
            role="button"
            aria-pressed={on}
            title={isMe ? `${m.displayName}（只看我的）` : m.displayName}
            onClick={() => setFilter(isMe ? 'me' : m.userId)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                borderRadius: '50%',
                padding: 2,
                boxShadow: on ? '0 0 0 2px var(--accent)' : 'none',
                transition: 'box-shadow .1s',
              }}
            >
              <Avatar name={m.displayName} size={24} />
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: on ? 'var(--accent)' : 'var(--faint)',
                background: on ? 'var(--accent-soft)' : 'var(--card-2)',
                borderRadius: 20,
                padding: '1px 7px',
              }}
            >
              {count}
            </span>
          </span>
        )
      })}
      {filter === 'me' && (
        <span style={{ fontSize: 11, color: 'var(--faint)' }}>只看我的（含未指派）</span>
      )}
    </div>
  )
}

function Column({
  status,
  label,
  dot,
  tasks,
  projectKey,
  unassignedTag,
  onOpen,
}: {
  status: TaskStatus
  label: string
  dot: string
  tasks: TaskBrief[]
  projectKey?: string
  unassignedTag?: boolean
  onOpen: (task: TaskBrief) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1,
        minWidth: 240,
        display: 'flex',
        flexDirection: 'column',
        background: isOver ? 'var(--accent-soft)' : 'var(--panel)',
        border: `1px solid ${isOver ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: '12px 10px 8px',
        minHeight: 0,
        transition: 'background .12s, border-color .12s',
      }}
    >
      {/* 列头：色点 + 中文名 + mono 计数胶囊 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 4px 10px',
          flex: 'none',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--faint)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--card-2)',
            borderRadius: 20,
            padding: '1px 7px',
          }}
        >
          {tasks.length}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '1px 1px 4px',
        }}
      >
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            projectKey={projectKey}
            unassignedTag={unassignedTag}
            onOpen={onOpen}
          />
        ))}
        {tasks.length === 0 && (
          <div
            style={{
              border: '1.5px dashed var(--border-strong)',
              borderRadius: 9,
              minHeight: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: 'var(--faint)',
            }}
          >
            拖拽到此处
          </div>
        )}
      </div>
    </div>
  )
}

/** 看板骨架屏：四列 + 每列若干 .sk 卡片占位 */
function BoardSkeleton() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        gap: 14,
        padding: '0 20px 20px',
        overflowX: 'auto',
      }}
    >
      {COLUMNS.map((col, i) => (
        <div
          key={col.status}
          style={{
            flex: 1,
            minWidth: 240,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 10px 8px',
          }}
        >
          <div className="sk" style={{ height: 14, width: 90, marginBottom: 4 }} />
          {Array.from({ length: 3 - (i % 2) }).map((_, j) => (
            <div key={j} className="sk" style={{ height: 96, borderRadius: 10 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 页面头部：标题 + Sprint 信息 + 右侧提示（设计稿 BOARD 头） */
function BoardHeader({ sub }: { sub?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 20px 12px',
        flex: 'none',
      }}
    >
      <h1 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>看板</h1>
      {sub}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: 'var(--faint)' }}>拖拽卡片切换状态</span>
    </div>
  )
}

/** 空态/异常提示块（无项目 / 无活跃 Sprint / 加载失败） */
function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ padding: '8px 20px' }}>
      <div
        style={{
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 12,
          minHeight: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          color: 'var(--faint)',
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** 距 endDate 剩余天数（含当天，向上取整，最小 0） */
function daysLeft(endDate: string): number {
  const end = new Date(`${endDate}T23:59:59`)
  const diff = end.getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

export default function Board() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const toast = useToast()

  const projectsQuery = useProjects(slug)
  const projects = projectsQuery.data ?? []
  const projectKey = searchParams.get('project') ?? projects[0]?.key ?? ''

  const sprintsQuery = useSprints(slug, projectKey)
  const activeSprint = sprintsQuery.data?.find((s) => s.status === 'ACTIVE') ?? null

  const boardQuery = useBoard(slug, activeSprint?.id)
  const boardKey = useMemo(
    () => qk.board(slug, activeSprint?.id ?? -1),
    [slug, activeSprint?.id],
  )
  const columns = boardQuery.data?.columns ?? EMPTY_COLUMNS

  // 成员筛选：作用于四列卡片（乐观更新仍写原始缓存，过滤只在渲染层）
  const [assigneeFilter] = useAssigneeFilter()
  const filteredColumns = useMemo(() => {
    const next = {} as Record<TaskStatus, TaskBrief[]>
    for (const { status } of COLUMNS) {
      next[status] = (columns[status] ?? []).filter((t) =>
        taskMatchesFilter(t.assigneeId, assigneeFilter),
      )
    }
    return next
  }, [columns, assigneeFilter])

  const [activeTask, setActiveTask] = useState<TaskBrief | null>(null)
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as TaskBrief | undefined
    setActiveTask(task ?? null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return
    const task = active.data.current?.task as TaskBrief | undefined
    const toStatus = over.id as TaskStatus
    if (!task || task.status === toStatus) return

    // 乐观更新：先改本地缓存，PATCH 失败回滚
    await queryClient.cancelQueries({ queryKey: boardKey })
    const previous = queryClient.getQueryData<BoardData>(boardKey)
    queryClient.setQueryData<BoardData>(boardKey, (old) => {
      if (!old) return old
      const next: Record<TaskStatus, TaskBrief[]> = {
        TODO: old.columns.TODO.filter((t) => t.id !== task.id),
        IN_PROGRESS: old.columns.IN_PROGRESS.filter((t) => t.id !== task.id),
        COMPLETED: old.columns.COMPLETED.filter((t) => t.id !== task.id),
        DONE: old.columns.DONE.filter((t) => t.id !== task.id),
      }
      next[toStatus] = [...next[toStatus], { ...task, status: toStatus }]
      return { ...old, columns: next }
    })
    const displayId = projectKey ? `${projectKey}-${task.seq}` : `#${task.seq}`
    try {
      await api(`/api/t/${slug}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: toStatus }),
      })
      // 成功后同步服务端真值（含 done_at 等衍生变化）
      queryClient.invalidateQueries({ queryKey: boardKey })
      toast.show(`${displayId} → ${STATUS_LABEL[toStatus]}`)
    } catch {
      // 失败回滚
      if (previous) queryClient.setQueryData(boardKey, previous)
      else queryClient.invalidateQueries({ queryKey: boardKey })
      toast.show(`${displayId} 状态更新失败，已回滚`, 'info')
    }
  }

  // ---- 前置分支：加载 / 无项目 / 无活跃 Sprint ----
  if (projectsQuery.isLoading || sprintsQuery.isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <BoardHeader sub={<span className="sk" style={{ width: 120, height: 12, display: 'inline-block' }} />} />
        <BoardSkeleton />
      </div>
    )
  }
  if (!projectKey) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <BoardHeader />
        <EmptyHint text="还没有项目，请先创建项目" />
      </div>
    )
  }
  if (!activeSprint) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <BoardHeader />
        <EmptyHint text={`项目 ${projectKey} 没有进行中的 Sprint，去规划页启动一个吧`} />
      </div>
    )
  }

  const left = daysLeft(activeSprint.endDate)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <BoardHeader
        sub={
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {activeSprint.name} · 剩 <b style={{ color: 'var(--comp)' }}>{left}</b> 天
          </span>
        }
      />
      {boardQuery.isLoading ? (
        <BoardSkeleton />
      ) : boardQuery.isError ? (
        <EmptyHint text="看板加载失败，请刷新重试" />
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <AssigneeFilterRow slug={slug} columns={columns} />
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              gap: 14,
              padding: '0 20px 20px',
              overflowX: 'auto',
            }}
          >
            {COLUMNS.map((col) => (
              <Column
                key={col.status}
                status={col.status}
                label={col.label}
                dot={col.dot}
                tasks={filteredColumns[col.status] ?? []}
                projectKey={projectKey}
                unassignedTag={assigneeFilter === 'me'}
                onOpen={setDrawerTask}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                projectKey={projectKey}
                showStatus={false}
                style={{ boxShadow: 'var(--shadow)', transform: 'rotate(2deg)' }}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
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
