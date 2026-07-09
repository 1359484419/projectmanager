// TaskDrawer：右侧任务详情抽屉。视觉真源：docs/design/mock/markup.html TASK DRAWER 节 + logic.jsx drawer。
// 行内编辑 title/description/type/points/status/assignee/epic（每项改动即 PATCH /tasks/{id}）；
// 下方 Tab：评论（提交/列表）与变更历史（时间线，MCP 来源带 via MCP 小标记）。
// 打开时用列表页已有的 TaskBrief 作 seed 立即渲染，同时 GET /tasks/{id} 拉全量字段（description/epicId 等）。
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  useActivities,
  useComments,
  useCreateComment,
  useDeleteTask,
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
import { isConflictError } from '../api/client'
import { Icon } from './icons'
import { avatarColor } from './TaskCard'
import TypeIcon from './TypeIcon'
import { SelectWrap, selStyle, statusColor, STATUS_OPTIONS, TYPE_OPTIONS } from './ui'
import { POINTS_CHOICES, fmtPoints } from '../utils/points'

export interface TaskDrawerProps {
  slug: string
  /** 项目 key，用于展示号 "PM-42" 与 Epic 下拉 */
  projectKey: string
  /** 列表页已有的精简任务，作为抽屉首屏 seed */
  task: TaskBrief
  onClose: () => void
}

// ---------- 变更历史文案（who 加粗 + text，同设计稿时间线） ----------

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

function activityWho(a: Activity): string {
  return a.actorName ?? `用户 #${a.actorId}`
}

/** 枚举值转设计稿中文文案（状态/类型），映射不到的原样返回 */
const ENUM_LABEL: Record<string, string> = {
  TODO: '待办',
  IN_PROGRESS: '进行中',
  COMPLETED: '待验收',
  DONE: '已完成',
  STORY: '故事',
  BUG: '缺陷',
  TASK: '任务',
}

function humanValue(v: string | null): string {
  if (v == null || v === '') return '空'
  return ENUM_LABEL[v] ?? v
}

function activityText(a: Activity): string {
  if (a.type === 'CREATED') return '创建了任务'
  if (a.type === 'COMMENTED') return '发表了评论'
  const field = ACTIVITY_FIELD_LABEL[a.type]
  const oldV = humanValue(a.oldValue)
  const newV = humanValue(a.newValue)
  if (field) return `把${field}从 ${oldV} 改为 ${newV}`
  // 未知类型兜底：直接展示原始 type 与新旧值
  return `${a.type}: ${oldV} → ${newV}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 样式 ----------

const dimLabelStyle: CSSProperties = { color: 'var(--dim)' }

const hintStyle: CSSProperties = { fontSize: 13, color: 'var(--faint)' }

const errorStyle: CSSProperties = { fontSize: 12.5, color: 'var(--type-bug)' }

function tabStyle(on: boolean): CSSProperties {
  return {
    padding: '8px 12px',
    fontSize: 12.5,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
    color: on ? 'var(--text)' : 'var(--dim)',
    fontWeight: on ? 600 : 450,
    marginBottom: -1,
  }
}

function SkeletonLines({ rows }: { rows: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span className="sk" style={{ width: 26, height: 26, borderRadius: '50%', flex: 'none' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="sk" style={{ height: 12, width: '38%' }} />
            <span className="sk" style={{ height: 12, width: '82%' }} />
          </div>
        </div>
      ))}
    </div>
  )
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
    <div>
      {comments.isLoading && <SkeletonLines rows={2} />}
      {comments.isError && (
        <div style={{ ...errorStyle, marginBottom: 14 }}>评论加载失败：{comments.error.message}</div>
      )}
      {comments.data && comments.data.length === 0 && (
        <div style={{ ...hintStyle, marginBottom: 14 }}>还没有评论。</div>
      )}
      {comments.data && comments.data.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
          {comments.data.map((c) => {
            const who = c.authorName ?? `用户 #${c.authorId}`
            return (
              <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: avatarColor(who),
                    color: '#fff',
                    fontSize: 9.5,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 'none',
                  }}
                >
                  {who.charAt(0).toUpperCase()}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{who}</span>
                    <span style={{ fontSize: 11, color: 'var(--faint)' }}>{formatTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="写下评论，回车发送…"
          aria-label="评论内容"
          style={{
            flex: 1,
            height: 34,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--text)',
            fontSize: 13,
            padding: '0 11px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!body.trim() || createComment.isPending}
          className="btn-primary"
          style={{
            height: 34,
            padding: '0 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: !body.trim() || createComment.isPending ? 0.55 : 1,
          }}
        >
          {createComment.isPending ? '发送中…' : '发送'}
        </button>
      </div>
      {createComment.isError && (
        <div style={{ ...errorStyle, marginTop: 8 }}>发送失败：{createComment.error.message}</div>
      )}
    </div>
  )
}

// ---------- 子块：变更历史（时间线 + via MCP 标记） ----------

function ActivitiesTab({ slug, taskId }: { slug: string; taskId: number }) {
  const activities = useActivities(slug, taskId)
  if (activities.isLoading) return <SkeletonLines rows={3} />
  if (activities.isError)
    return <div style={errorStyle}>历史加载失败：{activities.error.message}</div>
  const list = activities.data ?? []
  if (list.length === 0) return <div style={hintStyle}>暂无变更历史。</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((a, i) => (
        <div key={a.id} style={{ display: 'flex', gap: 11, paddingBottom: 16, position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--accent)',
                marginTop: 5,
              }}
            />
            {i !== list.length - 1 && (
              <span style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 3 }} />
            )}
          </div>
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--text)' }}>
              <b style={{ fontWeight: 600 }}>{activityWho(a)}</b> {activityText(a)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2 }}>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{formatTime(a.at)}</span>
              {a.source === 'MCP' && (
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                    borderRadius: 4,
                    padding: '0 5px',
                  }}
                >
                  via MCP
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- 主组件 ----------

export default function TaskDrawer({ slug, projectKey, task: seed, onClose }: TaskDrawerProps) {
  const taskQuery = useTask(slug, seed.id)
  const updateTask = useUpdateTask(slug)
  const deleteTask = useDeleteTask(slug)
  const members = useMembers(slug)
  const epics = useEpics(slug, projectKey)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 全量数据：详情接口返回前先用 seed 渲染
  const task: Partial<Task> & TaskBrief = useMemo(
    () => ({ ...seed, ...(taskQuery.data ?? {}) }),
    [seed, taskQuery.data],
  )

  // 行内编辑草稿（title/description 本地暂存，blur/Enter 提交）
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [tab, setTab] = useState<'comments' | 'activities'>('comments')

  // 服务端真值到达/变化时同步草稿
  useEffect(() => {
    setTitle(task.title)
  }, [task.title])
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

  const displayId = `${projectKey}-${seed.seq}`

  // points 下拉（0.5-5，0.5 步进）：规则之外的存量值（如旧数据 8）也要能显示
  const pointsValue = task.points != null ? String(task.points) : ''
  const pointsChoices =
    task.points != null && !POINTS_CHOICES.includes(task.points)
      ? [...POINTS_CHOICES, task.points].sort((a, b) => a - b)
      : POINTS_CHOICES

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.45)',
          zIndex: 60,
          animation: 'fadeIn .12s',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`任务详情 ${displayId}`}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: '92vw',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          zIndex: 61,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-14px 0 40px -18px rgba(0,0,0,.8)',
          animation: 'drawerIn .18s ease',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            height: 52,
            flex: 'none',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 16px',
          }}
        >
          <TypeIcon type={task.type} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--faint)' }}>
            {displayId}
          </span>
          <span style={{ flex: 1 }} />
          {updateTask.isPending && (
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>保存中…</span>
          )}
          {updateTask.isError && (
            <span style={{ fontSize: 11, color: 'var(--type-bug)' }}>
              {isConflictError(updateTask.error)
                ? '他人已修改，已回填最新值，请重试'
                : `保存失败：${updateTask.error.message}`}
            </span>
          )}
          {deleteTask.isError && (
            <span style={{ fontSize: 11, color: 'var(--type-bug)' }}>
              {`删除失败：${deleteTask.error instanceof Error ? deleteTask.error.message : '未知错误'}`}
            </span>
          )}
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="删除任务"
              className="icon-btn"
              title="删除任务"
              style={{
                border: 'none',
                background: 'none',
                padding: 0,
                width: 16,
                height: 16,
                color: 'var(--dim)',
                cursor: 'pointer',
                display: 'flex',
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--type-bug)' }}>确认删除？</span>
              <button
                type="button"
                onClick={() => {
                  deleteTask.mutate(seed.id, { onSuccess: onClose })
                }}
                disabled={deleteTask.isPending}
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 5,
                  border: 'none',
                  background: 'var(--type-bug)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: deleteTask.isPending ? 0.55 : 1,
                }}
              >
                {deleteTask.isPending ? '删除中…' : '删除'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 5,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--dim)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="icon-btn"
            style={{
              border: 'none',
              background: 'none',
              padding: 0,
              width: 16,
              height: 16,
              color: 'var(--dim)',
              cursor: 'pointer',
              display: 'flex',
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 30px' }}>
          {/* 标题 */}
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
            rows={2}
            aria-label="任务标题"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.35,
              resize: 'none',
              marginBottom: 16,
              fontFamily: 'inherit',
            }}
          />

          {/* 属性网格 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '78px 1fr',
              gap: '10px 12px',
              alignItems: 'center',
              fontSize: 12.5,
              marginBottom: 20,
            }}
          >
            <span style={dimLabelStyle}>状态</span>
            <SelectWrap>
              <select
                aria-label="状态"
                value={task.status}
                onChange={(e) => patch({ status: e.target.value as TaskStatus })}
                style={{ ...selStyle, color: statusColor(task.status), fontWeight: 600 }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SelectWrap>

            <span style={dimLabelStyle}>类型</span>
            <SelectWrap>
              <select
                aria-label="类型"
                value={task.type}
                onChange={(e) => patch({ type: e.target.value as TaskType })}
                style={selStyle}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SelectWrap>

            <span style={dimLabelStyle}>Points</span>
            <SelectWrap>
              <select
                aria-label="Points"
                value={pointsValue}
                onChange={(e) =>
                  patch({ points: e.target.value ? Number(e.target.value) : null })
                }
                style={selStyle}
              >
                <option value="">未估点</option>
                {pointsChoices.map((p) => (
                  <option key={p} value={String(p)}>
                    {fmtPoints(p)} pts
                  </option>
                ))}
              </select>
            </SelectWrap>

            <span style={dimLabelStyle}>负责人</span>
            <SelectWrap>
              <select
                aria-label="负责人"
                value={task.assigneeId != null ? String(task.assigneeId) : ''}
                onChange={(e) =>
                  patch({ assigneeId: e.target.value ? Number(e.target.value) : null })
                }
                style={selStyle}
              >
                <option value="">未分配</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </SelectWrap>

            <span style={dimLabelStyle}>Epic</span>
            <SelectWrap>
              <select
                aria-label="Epic"
                value={task.epicId != null ? String(task.epicId) : ''}
                onChange={(e) => patch({ epicId: e.target.value ? Number(e.target.value) : null })}
                style={selStyle}
              >
                <option value="">无</option>
                {(epics.data ?? []).map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>

          {/* 描述 */}
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>描述</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={4}
            placeholder="补充描述…"
            aria-label="描述"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--text)',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 9,
              padding: '11px 13px',
              marginBottom: 20,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />

          {/* Tab：评论 / 变更历史 */}
          <div
            role="tablist"
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--border)',
              marginBottom: 14,
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
                style={tabStyle(tab === t.key)}
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
    </>
  )
}
