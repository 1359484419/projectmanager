// TaskDrawer：右侧任务详情抽屉。
// 行内编辑 title/description/type/points/status/assignee/epic（每项改动即 PATCH /tasks/{id}）；
// 下方 Tab：评论（提交/列表）与变更历史（activities 渲染成「xx 把状态从 A 改为 B · 时间 · 来源」）。
// 打开时用列表页已有的 TaskBrief 作 seed 立即渲染，同时 GET /tasks/{id} 拉全量字段（description/epicId 等）。
import { useEffect, useMemo, useState } from 'react'
import {
  useActivities,
  useComments,
  useCreateComment,
  useEpics,
  useMembers,
  useTask,
  useUpdateTask,
} from '../api/hooks'
import type {
  Activity,
  Task,
  TaskBrief,
  TaskStatus,
  TaskType,
  UpdateTaskInput,
} from '../api/types'
import StatusBadge from './StatusBadge'
import TypeIcon from './TypeIcon'

export interface TaskDrawerProps {
  slug: string
  /** 项目 key，用于展示号 "PM-42" 与 Epic 下拉 */
  projectKey: string
  /** 列表页已有的精简任务，作为抽屉首屏 seed */
  task: TaskBrief
  onClose: () => void
}

const STATUS_OPTIONS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'DONE']
const TYPE_OPTIONS: TaskType[] = ['STORY', 'BUG', 'TASK']

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  DONE: 'Done',
}

// ---------- 变更历史文案 ----------

const ACTIVITY_FIELD_LABEL: Record<string, string> = {
  STATUS_CHANGED: '状态',
  POINTS_CHANGED: 'Points',
  ASSIGNEE_CHANGED: '负责人',
  EPIC_CHANGED: 'Epic',
  SPRINT_CHANGED: 'Sprint',
  TITLE_CHANGED: '标题',
  DESCRIPTION_CHANGED: '描述',
  TYPE_CHANGED: '类型',
}

function activityText(a: Activity): string {
  const actor = a.actorName ?? `用户 #${a.actorId}`
  if (a.type === 'CREATED') return `${actor} 创建了任务`
  if (a.type === 'COMMENTED') return `${actor} 发表了评论`
  const field = ACTIVITY_FIELD_LABEL[a.type]
  const oldV = a.oldValue ?? '空'
  const newV = a.newValue ?? '空'
  if (field) return `${actor} 把${field}从 ${oldV} 改为 ${newV}`
  // 未知类型兜底：直接展示原始 type 与新旧值
  return `${actor} ${a.type}: ${oldV} → ${newV}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 样式 ----------

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  marginBottom: 4,
  display: 'block',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  fontSize: 13,
  background: '#fff',
  boxSizing: 'border-box',
}

// ---------- 子块：评论 ----------

function CommentsTab({ slug, taskId }: { slug: string; taskId: number }) {
  const comments = useComments(slug, taskId)
  const createComment = useCreateComment(slug, taskId)
  const [body, setBody] = useState('')

  const submit = () => {
    const trimmed = body.trim()
    if (!trimmed || createComment.isPending) return
    createComment.mutate(trimmed, { onSuccess: () => setBody('') })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="写评论…"
          rows={3}
          aria-label="评论内容"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            fontSize: 13,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim() || createComment.isPending}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: !body.trim() || createComment.isPending ? 0.5 : 1,
            }}
          >
            {createComment.isPending ? '提交中…' : '提交'}
          </button>
          {createComment.isError && (
            <span style={{ fontSize: 12, color: '#dc2626' }}>
              提交失败：{createComment.error.message}
            </span>
          )}
        </div>
      </div>

      {comments.isLoading && <div style={{ fontSize: 13, color: '#9ca3af' }}>评论加载中…</div>}
      {comments.isError && (
        <div style={{ fontSize: 13, color: '#dc2626' }}>评论加载失败：{comments.error.message}</div>
      )}
      {comments.data && comments.data.length === 0 && (
        <div style={{ fontSize: 13, color: '#9ca3af' }}>还没有评论。</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(comments.data ?? []).map((c) => (
          <div
            key={c.id}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '8px 12px',
              background: '#f9fafb',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                {c.authorName ?? `用户 #${c.authorId}`}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{formatTime(c.createdAt)}</span>
            </div>
            <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- 子块：变更历史 ----------

function ActivitiesTab({ slug, taskId }: { slug: string; taskId: number }) {
  const activities = useActivities(slug, taskId)
  if (activities.isLoading) return <div style={{ fontSize: 13, color: '#9ca3af' }}>历史加载中…</div>
  if (activities.isError)
    return (
      <div style={{ fontSize: 13, color: '#dc2626' }}>
        历史加载失败：{activities.error.message}
      </div>
    )
  const list = activities.data ?? []
  if (list.length === 0) return <div style={{ fontSize: 13, color: '#9ca3af' }}>暂无变更历史。</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((a) => (
        <div
          key={a.id}
          style={{
            fontSize: 13,
            color: '#374151',
            padding: '6px 0',
            borderBottom: '1px solid #f3f4f6',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'baseline',
          }}
        >
          <span>{activityText(a)}</span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            · {formatTime(a.at)}
            {a.source ? ` · 来源 ${a.source}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------- 主组件 ----------

export default function TaskDrawer({ slug, projectKey, task: seed, onClose }: TaskDrawerProps) {
  const taskQuery = useTask(slug, seed.id)
  const updateTask = useUpdateTask(slug)
  const members = useMembers(slug)
  const epics = useEpics(slug, projectKey)

  // 全量数据：详情接口返回前先用 seed 渲染
  const task: Partial<Task> & TaskBrief = useMemo(
    () => ({ ...seed, ...(taskQuery.data ?? {}) }),
    [seed, taskQuery.data],
  )

  // 行内编辑草稿（title/description/points 需本地暂存，blur/Enter 提交）
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [points, setPoints] = useState(task.points != null ? String(task.points) : '')
  const [tab, setTab] = useState<'comments' | 'activities'>('comments')

  // 服务端真值到达/变化时同步草稿
  useEffect(() => {
    setTitle(task.title)
    setPoints(task.points != null ? String(task.points) : '')
  }, [task.title, task.points])
  useEffect(() => {
    setDescription(task.description ?? '')
  }, [task.description])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (input: UpdateTaskInput) => updateTask.mutate({ id: seed.id, ...input })

  const saveTitle = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitle(task.title)
      return
    }
    if (trimmed !== task.title) patch({ title: trimmed })
  }

  const saveDescription = () => {
    const next = description.trim() === '' ? null : description
    if (next !== (task.description ?? null)) patch({ description: next })
  }

  const savePoints = () => {
    const parsed = Number.parseInt(points, 10)
    const next = Number.isInteger(parsed) && parsed > 0 ? parsed : null
    if (next !== (task.points ?? null)) patch({ points: next })
  }

  const displayId = `${projectKey}-${seed.seq}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`任务详情 ${displayId}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '92vw',
          height: '100%',
          background: '#fff',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 20px',
            borderBottom: '1px solid #e5e7eb',
            position: 'sticky',
            top: 0,
            background: '#fff',
            zIndex: 1,
          }}
        >
          <TypeIcon type={task.type} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>{displayId}</span>
          <StatusBadge status={task.status} />
          {updateTask.isPending && (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>保存中…</span>
          )}
          {updateTask.isError && (
            <span style={{ fontSize: 12, color: '#dc2626' }}>
              保存失败：{updateTask.error.message}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              fontSize: 18,
              color: '#6b7280',
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 标题 */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            aria-label="任务标题"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 16,
              fontWeight: 600,
            }}
          />

          {/* 属性网格 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={fieldLabelStyle} htmlFor="drawer-type">
                类型
              </label>
              <select
                id="drawer-type"
                style={selectStyle}
                value={task.type}
                onChange={(e) => patch({ type: e.target.value as TaskType })}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={fieldLabelStyle} htmlFor="drawer-status">
                状态
              </label>
              <select
                id="drawer-status"
                style={selectStyle}
                value={task.status}
                onChange={(e) => patch({ status: e.target.value as TaskStatus })}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={fieldLabelStyle} htmlFor="drawer-points">
                Points（1 point = 1 人天）
              </label>
              <input
                id="drawer-points"
                style={selectStyle}
                value={points}
                inputMode="numeric"
                placeholder="未估点"
                onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={savePoints}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            </div>
            <div>
              <label style={fieldLabelStyle} htmlFor="drawer-assignee">
                负责人
              </label>
              <select
                id="drawer-assignee"
                style={selectStyle}
                value={task.assigneeId != null ? String(task.assigneeId) : ''}
                onChange={(e) =>
                  patch({ assigneeId: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">未指派</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fieldLabelStyle} htmlFor="drawer-epic">
                Epic
              </label>
              <select
                id="drawer-epic"
                style={selectStyle}
                value={task.epicId != null ? String(task.epicId) : ''}
                onChange={(e) => patch({ epicId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">无 Epic</option>
                {(epics.data ?? []).map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label style={fieldLabelStyle} htmlFor="drawer-desc">
              描述
            </label>
            <textarea
              id="drawer-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              rows={4}
              placeholder="补充描述…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                fontSize: 13,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Tab：评论 / 历史 */}
          <div>
            <div
              role="tablist"
              style={{
                display: 'flex',
                gap: 4,
                borderBottom: '1px solid #e5e7eb',
                marginBottom: 12,
              }}
            >
              {(
                [
                  { key: 'comments', label: '评论' },
                  { key: 'activities', label: '变更历史' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  style={{
                    padding: '8px 14px',
                    border: 'none',
                    background: 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: tab === t.key ? '#4f46e5' : '#6b7280',
                    borderBottom: tab === t.key ? '2px solid #4f46e5' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === 'comments' ? (
              <CommentsTab slug={slug} taskId={seed.id} />
            ) : (
              <ActivitiesTab slug={slug} taskId={seed.id} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
