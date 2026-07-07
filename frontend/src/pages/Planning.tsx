import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
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
import {
  useBacklog,
  useCapacity,
  useProjects,
  useSetCapacity,
  useSprints,
  useUpdateTask,
} from '../api/hooks'
import type { Sprint, SprintWithTasks, Task, TaskBrief } from '../api/types'
import TaskCard from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'
import CapacityBar from '../components/CapacityBar'

const BACKLOG_ZONE = 'backlog'
const sprintZone = (id: number) => `sprint-${id}`

function toBrief(t: Task): TaskBrief {
  return {
    id: t.id,
    seq: t.seq,
    type: t.type,
    title: t.title,
    status: t.status,
    points: t.points,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeName,
  }
}

/** 可拖拽的任务卡片包装（原地点击开抽屉，移动超过 4px 才触发拖拽） */
function DraggableTask({
  task,
  projectKey,
  onOpen,
}: {
  task: TaskBrief
  projectKey?: string
  onOpen: (task: TaskBrief) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { taskId: task.id },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab', touchAction: 'none' }}
    >
      <TaskCard task={task} projectKey={projectKey} showStatus={false} onClick={onOpen} />
    </div>
  )
}

/** 单个 Sprint 的容量条区块（每人 assigned/capacity，点数字改 override） */
function SprintCapacity({ slug, sprintId }: { slug: string; sprintId: number }) {
  const { data: entries, isLoading, isError } = useCapacity(slug, sprintId)
  const setCapacity = useSetCapacity(slug, sprintId)

  if (isLoading) return <div style={{ fontSize: 12, color: '#9ca3af' }}>容量加载中…</div>
  if (isError) return <div style={{ fontSize: 12, color: '#ef4444' }}>容量加载失败</div>
  if (!entries || entries.length === 0)
    return <div style={{ fontSize: 12, color: '#9ca3af' }}>暂无成员容量数据</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map((e) => (
        <CapacityBar
          key={e.userId}
          name={e.displayName}
          assigned={e.assignedPoints}
          capacity={e.capacity}
          onCapacityChange={(capacity) => setCapacity.mutate({ userId: e.userId, capacity })}
        />
      ))}
    </div>
  )
}

/** 右侧 Sprint 区块：可放置目标 + 任务列表 + 容量条 */
function SprintSection({
  slug,
  sprint,
  projectKey,
  onMoveToBacklog,
  onOpenTask,
}: {
  slug: string
  sprint: SprintWithTasks
  projectKey?: string
  onMoveToBacklog: (taskId: number) => void
  onOpenTask: (task: TaskBrief) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: sprintZone(sprint.id) })
  const totalPoints = sprint.tasks.reduce((sum, t) => sum + (t.points ?? 0), 0)

  return (
    <section
      ref={setNodeRef}
      style={{
        border: `2px dashed ${isOver ? '#6366f1' : '#e5e7eb'}`,
        borderRadius: 12,
        padding: 16,
        background: isOver ? '#eef2ff' : '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{sprint.name}</h3>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '1px 8px',
            borderRadius: 9999,
            color: sprint.status === 'ACTIVE' ? '#166534' : '#374151',
            background: sprint.status === 'ACTIVE' ? '#dcfce7' : '#f3f4f6',
          }}
        >
          {sprint.status}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {sprint.startDate} ~ {sprint.endDate} · {sprint.tasks.length} 任务 · {totalPoints} pts
        </span>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sprint.tasks.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0', textAlign: 'center' }}>
            从左侧 Backlog 拖任务到这里
          </div>
        ) : (
          sprint.tasks.map((task) => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <TaskCard task={task} projectKey={projectKey} showStatus onClick={onOpenTask} />
              </div>
              <button
                title="移回 Backlog"
                onClick={() => onMoveToBacklog(task.id)}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                ←
              </button>
            </div>
          ))
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>
          成员容量（已分配 / 容量）
        </div>
        <SprintCapacity slug={slug} sprintId={sprint.id} />
      </div>
    </section>
  )
}

export default function Planning() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { data: projects, isLoading: projectsLoading } = useProjects(slug)
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const key = projectKey ?? projects?.[0]?.key ?? ''

  const { data: backlog, isLoading: backlogLoading } = useBacklog(slug, key)
  const { data: sprints, isLoading: sprintsLoading } = useSprints(slug, key, true)
  const updateTask = useUpdateTask(slug)

  const [activeTask, setActiveTask] = useState<TaskBrief | null>(null)
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // 规划目标：ACTIVE + PLANNED（当前/下个），按开始日期排
  const planSprints = useMemo(() => {
    const list = (sprints ?? []) as SprintWithTasks[]
    return list
      .filter((s: Sprint) => s.status === 'ACTIVE' || s.status === 'PLANNED')
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [sprints])

  const backlogBriefs = useMemo(() => (backlog ?? []).map(toBrief), [backlog])

  const { setNodeRef: setBacklogRef, isOver: overBacklog } = useDroppable({ id: BACKLOG_ZONE })

  function handleDragStart(event: DragStartEvent) {
    const taskId = event.active.data.current?.taskId as number | undefined
    setActiveTask(backlogBriefs.find((t) => t.id === taskId) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const taskId = event.active.data.current?.taskId as number | undefined
    const overId = event.over?.id
    if (taskId == null || overId == null) return
    if (typeof overId === 'string' && overId.startsWith('sprint-')) {
      const sprintId = Number(overId.slice('sprint-'.length))
      updateTask.mutate({ id: taskId, sprintId })
    }
  }

  function moveToBacklog(taskId: number) {
    updateTask.mutate({ id: taskId, sprintId: null })
  }

  if (projectsLoading) return <PageShell>加载中…</PageShell>
  if (!projects || projects.length === 0)
    return <PageShell>还没有项目，请先在 Backlog 页创建项目。</PageShell>

  return (
    <PageShell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Sprint 规划</h2>
        <select
          value={key}
          onChange={(e) => setProjectKey(e.target.value)}
          style={{ padding: '4px 8px', fontSize: 14 }}
        >
          {projects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, alignItems: 'start' }}>
          {/* 左：Backlog 简表 */}
          <section
            ref={setBacklogRef}
            style={{
              border: `2px dashed ${overBacklog ? '#6366f1' : '#e5e7eb'}`,
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16 }}>
              Backlog{backlog ? `（${backlog.length}）` : ''}
            </h3>
            {backlogLoading ? (
              <div style={{ fontSize: 13, color: '#9ca3af' }}>加载中…</div>
            ) : backlogBriefs.length === 0 ? (
              <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>
                Backlog 为空。
              </div>
            ) : (
              backlogBriefs.map((task) => (
                <DraggableTask key={task.id} task={task} projectKey={key} onOpen={setDrawerTask} />
              ))
            )}
          </section>

          {/* 右：当前 / 下个 Sprint */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sprintsLoading ? (
              <div style={{ fontSize: 13, color: '#9ca3af' }}>Sprint 加载中…</div>
            ) : planSprints.length === 0 ? (
              <div
                style={{
                  border: '2px dashed #e5e7eb',
                  borderRadius: 12,
                  padding: 24,
                  fontSize: 13,
                  color: '#9ca3af',
                  textAlign: 'center',
                }}
              >
                没有进行中或计划中的 Sprint，请先在 All Sprints 页创建。
              </div>
            ) : (
              planSprints.map((s) => (
                <SprintSection
                  key={s.id}
                  slug={slug}
                  sprint={s}
                  projectKey={key}
                  onMoveToBacklog={moveToBacklog}
                  onOpenTask={setDrawerTask}
                />
              ))
            )}
          </div>
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} projectKey={key} showStatus={false} /> : null}
        </DragOverlay>
      </DndContext>
      {drawerTask && (
        <TaskDrawer
          slug={slug}
          projectKey={key}
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
        />
      )}
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>{children}</div>
}
