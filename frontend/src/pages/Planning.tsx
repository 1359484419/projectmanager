// Sprint 规划：左 Backlog 拖入右侧 Sprint，成员容量条（超载红斜纹）+ 容量行内编辑
// 视觉真源：docs/design/mock/markup.html PLANNING 节 + logic.jsx memberLoad()
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
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
import { Icon } from '../components/icons'
import { SelectWrap, cardStyle, pageTitleStyle, selStyle, useToast } from '../components/ui'
import { fmtPoints } from '../utils/points'

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

// ---------------- 样式常量（PLANNING 节） ----------------

/** 面板卡片：card 底 + 圆角 12 + 纵向弹性布局 */
const panelStyle: CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
}

/** 面板头（12px 14px + soft 分隔线） */
const panelHeadStyle: CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid var(--border-soft)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 'none',
}

const emptyHintStyle: CSSProperties = {
  fontSize: 12.5,
  color: 'var(--faint)',
  padding: '18px 0',
  textAlign: 'center',
}

/** 38px 任务行骨架（mock hint-size 100%,38px） */
function RowSkeletons({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk" style={{ height: 38, margin: '0 0 4px' }} />
      ))}
    </>
  )
}

/** 可拖拽的任务行（原地点击开抽屉，移动超过 4px 才触发拖拽） */
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
      <TaskCard task={task} projectKey={projectKey} variant="row" showStatus={false} onClick={onOpen} />
    </div>
  )
}

/** 成员容量卡（每人 assigned/capacity，行内编辑 override） */
function SprintCapacity({ slug, sprintId, title }: { slug: string; sprintId: number; title: string }) {
  const { data: entries, isLoading, isError } = useCapacity(slug, sprintId)
  const setCapacity = useSetCapacity(slug, sprintId)
  const toast = useToast()

  let body: ReactNode
  if (isLoading) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="sk" style={{ height: 24 }} />
        ))}
      </div>
    )
  } else if (isError) {
    body = <div style={{ fontSize: 12.5, color: 'var(--over)' }}>容量加载失败</div>
  } else if (!entries || entries.length === 0) {
    body = <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>暂无成员容量数据</div>
  } else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.map((e) => (
          <CapacityBar
            key={e.userId}
            name={e.displayName}
            assigned={e.assignedPoints}
            capacity={e.capacity}
            onCapacityChange={(capacity) =>
              setCapacity.mutate(
                { userId: e.userId, capacity },
                {
                  onSuccess: () => toast.show('容量已更新'),
                  onError: () => toast.show('容量更新失败，请重试', 'info'),
                },
              )
            }
          />
        ))}
      </div>
    )
  }

  return (
    <div style={{ ...cardStyle, padding: '13px 15px', flex: 'none' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 12 }}>
        容量 = 本 Sprint 工作日数（1 point = 1 人天），点数字可按人调整（如请假）
      </div>
      {body}
    </div>
  )
}

/** 右侧单个 Sprint：任务面板（可放置目标）+ 成员容量卡 */
function SprintSection({
  slug,
  sprint,
  projectKey,
  showSprintName,
  onMoveToBacklog,
  onOpenTask,
}: {
  slug: string
  sprint: SprintWithTasks
  projectKey?: string
  /** 多个 Sprint 时容量卡标题带 Sprint 名 */
  showSprintName: boolean
  onMoveToBacklog: (taskId: number) => void
  onOpenTask: (task: TaskBrief) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: sprintZone(sprint.id) })
  const totalPoints = sprint.tasks.reduce((sum, t) => sum + (t.points ?? 0), 0)
  const active = sprint.status === 'ACTIVE'

  return (
    <>
      <section
        ref={setNodeRef}
        style={{
          ...panelStyle,
          flex: 1,
          background: isOver ? 'var(--accent-soft)' : 'var(--card)',
          borderColor: isOver ? 'var(--accent)' : 'var(--border)',
          transition: 'background .12s, border-color .12s',
        }}
      >
        <div style={panelHeadStyle}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: active ? 'var(--prog)' : 'var(--todo)',
              animation: active ? 'pulse 1.6s infinite' : undefined,
              flex: 'none',
            }}
          />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{sprint.name}</span>
          <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            {fmtPoints(totalPoints)} pts
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            {sprint.startDate} ~ {sprint.endDate}
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {sprint.tasks.length === 0 ? (
            <div style={emptyHintStyle}>从左侧 Backlog 拖任务到这里</div>
          ) : (
            sprint.tasks.map((task) => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TaskCard
                    task={task}
                    projectKey={projectKey}
                    variant="row"
                    showStatus={false}
                    onClick={onOpenTask}
                  />
                </div>
                <span
                  className="icon-btn"
                  title="移回 Backlog"
                  role="button"
                  onClick={() => onMoveToBacklog(task.id)}
                  style={{ display: 'flex', flex: 'none', color: 'var(--faint)', padding: 5, cursor: 'pointer' }}
                >
                  <Icon name="arrowRight" size={13} style={{ transform: 'rotate(180deg)' }} />
                </span>
              </div>
            ))
          )}
        </div>
      </section>
      <SprintCapacity
        slug={slug}
        sprintId={sprint.id}
        title={showSprintName ? `成员容量 · ${sprint.name}` : '成员容量'}
      />
    </>
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
  const toast = useToast()

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
      updateTask.mutate(
        { id: taskId, sprintId },
        {
          onSuccess: () => toast.show('已移入 Sprint'),
          onError: () => toast.show('移动失败，请重试', 'info'),
        },
      )
    }
  }

  function moveToBacklog(taskId: number) {
    updateTask.mutate(
      { id: taskId, sprintId: null },
      {
        onSuccess: () => toast.show('已移回 Backlog'),
        onError: () => toast.show('移动失败，请重试', 'info'),
      },
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '20px 24px 12px',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h1 style={pageTitleStyle}>Sprint 规划</h1>
        {projects && projects.length > 0 && (
          <SelectWrap chevronTop={9} style={{ width: 200 }}>
            <select value={key} onChange={(e) => setProjectKey(e.target.value)} style={selStyle}>
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          </SelectWrap>
        )}
      </div>

      {projectsLoading ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            padding: '0 24px 20px',
          }}
        >
          <div className="sk" style={{ borderRadius: 12 }} />
          <div className="sk" style={{ borderRadius: 12 }} />
        </div>
      ) : !projects || projects.length === 0 ? (
        <div style={{ padding: '24px 24px', fontSize: 13, color: 'var(--faint)' }}>
          还没有项目，请先在 Backlog 页创建项目。
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              padding: '0 24px 20px',
            }}
          >
            {/* 左：Backlog 简表（可放置：拖回 Backlog） */}
            <section
              ref={setBacklogRef}
              style={{
                ...panelStyle,
                background: overBacklog ? 'var(--accent-soft)' : 'var(--card)',
                borderColor: overBacklog ? 'var(--accent)' : 'var(--border)',
                transition: 'background .12s, border-color .12s',
              }}
            >
              <div style={{ ...panelHeadStyle, fontSize: 12.5, fontWeight: 600, color: 'var(--dim)' }}>
                Backlog{' '}
                <span style={{ color: 'var(--faint)', fontWeight: 400 }}>
                  {backlog ? `· ${backlog.length} 项 · 拖入右侧` : '· 拖入右侧'}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                {backlogLoading ? (
                  <RowSkeletons count={5} />
                ) : backlogBriefs.length === 0 ? (
                  <div style={emptyHintStyle}>Backlog 为空。</div>
                ) : (
                  backlogBriefs.map((task) => (
                    <DraggableTask key={task.id} task={task} projectKey={key} onOpen={setDrawerTask} />
                  ))
                )}
              </div>
            </section>

            {/* 右：当前 / 下个 Sprint + 成员容量 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
              {sprintsLoading ? (
                <>
                  <div className="sk" style={{ flex: 1, borderRadius: 12 }} />
                  <div className="sk" style={{ height: 140, borderRadius: 12, flex: 'none' }} />
                </>
              ) : planSprints.length === 0 ? (
                <div style={{ ...panelStyle, justifyContent: 'center', flex: 1 }}>
                  <div style={emptyHintStyle}>没有进行中或计划中的 Sprint，请先在 All Sprints 页创建。</div>
                </div>
              ) : (
                planSprints.map((s) => (
                  <SprintSection
                    key={s.id}
                    slug={slug}
                    sprint={s}
                    projectKey={key}
                    showSprintName={planSprints.length > 1}
                    onMoveToBacklog={moveToBacklog}
                    onOpenTask={setDrawerTask}
                  />
                ))
              )}
            </div>
          </div>

          <DragOverlay>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                projectKey={key}
                variant="row"
                showStatus={false}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--accent)',
                  boxShadow: 'var(--shadow)',
                }}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {drawerTask && (
        <TaskDrawer
          slug={slug}
          projectKey={key}
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
        />
      )}
    </div>
  )
}
