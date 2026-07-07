// Sprint 看板：TODO / IN_PROGRESS / COMPLETED / DONE 四列，dnd-kit 拖拽改状态（乐观更新，失败回滚）
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
import { api } from '../api/client'
import { qk, useBoard, useProjects, useSprints } from '../api/hooks'
import type { Board as BoardData, TaskBrief, TaskStatus } from '../api/types'
import TaskCard from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'

const COLUMNS: { status: TaskStatus; label: string; accent: string }[] = [
  { status: 'TODO', label: 'To Do', accent: '#9ca3af' },
  { status: 'IN_PROGRESS', label: 'In Progress', accent: '#3b82f6' },
  { status: 'COMPLETED', label: 'Completed', accent: '#f59e0b' },
  { status: 'DONE', label: 'Done', accent: '#22c55e' },
]

const EMPTY_COLUMNS: Record<TaskStatus, TaskBrief[]> = {
  TODO: [],
  IN_PROGRESS: [],
  COMPLETED: [],
  DONE: [],
}

function DraggableCard({
  task,
  projectKey,
  onOpen,
}: {
  task: TaskBrief
  projectKey?: string
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
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: 'none', cursor: 'grab' }}
    >
      {/* PointerSensor distance=4：原地点击不会触发拖拽，click 正常冒泡开抽屉 */}
      <TaskCard task={task} projectKey={projectKey} showStatus={false} onClick={onOpen} />
    </div>
  )
}

function Column({
  status,
  label,
  accent,
  tasks,
  projectKey,
  onOpen,
}: {
  status: TaskStatus
  label: string
  accent: string
  tasks: TaskBrief[]
  projectKey?: string
  onOpen: (task: TaskBrief) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1,
        minWidth: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 12,
        background: isOver ? '#eef2ff' : '#f9fafb',
        border: `1px solid ${isOver ? '#c7d2fe' : '#e5e7eb'}`,
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{label}</span>
        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{tasks.length}</span>
      </div>
      {tasks.map((task) => (
        <DraggableCard key={task.id} task={task} projectKey={projectKey} onOpen={onOpen} />
      ))}
      {tasks.length === 0 && (
        <div
          style={{
            border: '1px dashed #d1d5db',
            borderRadius: 8,
            padding: '16px 12px',
            fontSize: 12,
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          拖到这里
        </div>
      )}
    </div>
  )
}

export default function Board() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()

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
    try {
      await api(`/api/t/${slug}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: toStatus }),
      })
      // 成功后同步服务端真值（含 done_at 等衍生变化）
      queryClient.invalidateQueries({ queryKey: boardKey })
    } catch {
      // 失败回滚
      if (previous) queryClient.setQueryData(boardKey, previous)
      else queryClient.invalidateQueries({ queryKey: boardKey })
    }
  }

  if (projectsQuery.isLoading || sprintsQuery.isLoading) {
    return <div style={{ padding: 24, color: '#6b7280' }}>加载中…</div>
  }
  if (!projectKey) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>看板</h1>
        <p style={{ color: '#6b7280' }}>还没有项目，请先创建项目。</p>
      </div>
    )
  }
  if (!activeSprint) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>看板</h1>
        <p style={{ color: '#6b7280' }}>
          当前项目 {projectKey} 没有进行中的 Sprint，去规划页启动一个吧。
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{activeSprint.name}</h1>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          {activeSprint.startDate} ~ {activeSprint.endDate}
        </span>
      </div>
      {boardQuery.isLoading ? (
        <div style={{ color: '#6b7280' }}>看板加载中…</div>
      ) : boardQuery.isError ? (
        <div style={{ color: '#b91c1c' }}>看板加载失败，请刷新重试。</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', overflowX: 'auto' }}>
            {COLUMNS.map((col) => (
              <Column
                key={col.status}
                status={col.status}
                label={col.label}
                accent={col.accent}
                tasks={columns[col.status] ?? []}
                projectKey={projectKey}
                onOpen={setDrawerTask}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <TaskCard task={activeTask} projectKey={projectKey} showStatus={false} />
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
