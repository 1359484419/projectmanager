// TaskDrawer：右侧任务详情抽屉。视觉真源：docs/design/mock/markup.html TASK DRAWER 节 + logic.jsx drawer。
// 行内编辑 title/description/type/points/status/assignee/epic（每项改动即 PATCH /tasks/{id}）；
// 下方 Tab：评论（提交/列表）与变更历史（时间线，MCP 来源带 via MCP 小标记）。
// 打开时用列表页已有的 TaskBrief 作 seed 立即渲染，同时 GET /tasks/{id} 拉全量字段（description/epicId 等）。
import { apiErrorMessage } from '../api/errors'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import {
  qk,
  useActivities,
  useComments,
  useCreateComment,
  useCreateSubtask,
  useDeleteSubtask,
  useDeleteTask,
  useEpics,
  useMembers,
  useSprints,
  useSubtasks,
  useTask,
  useUpdateSubtask,
  useUpdateTask,
} from '../api/hooks'
import type {
  Activity,
  Member,
  Sprint,
  Subtask,
  Task,
  TaskBrief,
  TaskStatus,
  TaskType,
  UpdateTaskInput,
} from '../api/types'
import { isConflictError } from '../api/client'
import { useI18n, useT } from '../i18n'
import type { Translations } from '../i18n'
import { Icon } from './icons'
import { avatarColor } from './TaskCard'
import TypeIcon from './TypeIcon'
import { SelectWrap, selStyle, statusColor, statusOptions, typeOptions } from './ui'
import { POINTS_CHOICES, fmtPoints } from '../utils/points'
import { fetchImageUrl, uploadTaskImage, useTaskImages } from '../api/hooks'
import { fetchSubtaskImageUrl, uploadSubtaskImage, useSubtaskImages } from '../api/hooks'
import { useEffect as useEffectImg, useState as useStateImg } from 'react'

export interface TaskDrawerProps {
  slug: string
  /** 项目 key，用于展示号 "PM-42" 与 Epic 下拉 */
  projectKey: string
  /** 列表页已有的精简任务，作为抽屉首屏 seed */
  task: TaskBrief
  onClose: () => void
}

// ---------- 变更历史文案（who 加粗 + text，同设计稿时间线） ----------

function activityFieldLabel(t: Translations): Record<string, string> {
  return {
    STATUS_CHANGED: t.fieldStatus, POINTS_CHANGED: t.fieldPoints,
    ASSIGNEE_CHANGED: t.fieldAssignee, EPIC_CHANGED: t.fieldEpic,
    SPRINT_CHANGED: t.fieldSprint, TITLE_CHANGED: t.fieldTitle,
    DESCRIPTION_CHANGED: t.fieldDescription, TYPE_CHANGED: t.fieldType,
  }
}

function activityWho(a: Activity, t: Translations): string {
  return a.actorName ?? t.userN(a.actorId)
}

/** 枚举值转设计稿中文文案（状态/类型），映射不到的原样返回 */
function enumLabel(t: Translations): Record<string, string> {
  return {
    TODO: t.statusTodo, IN_PROGRESS: t.statusInProgress, COMPLETED: t.statusCompleted,
    DONE: t.statusDone, STORY: t.typeStory, BUG: t.typeBug, TASK: t.typeTask,
  }
}

function humanValue(v: string | null, t: Translations): string {
  if (v == null || v === '') return t.empty
  return enumLabel(t)[v] ?? v
}

function activityText(a: Activity, t: Translations): string {
  if (a.type === 'CREATED') return t.createdTask
  if (a.type === 'COMMENTED') return t.postedComment
  // 子任务留痕：old/newValue 承载子任务标题
  if (a.type === 'SUBTASK_CREATED') return t.activitySubtaskCreated(a.newValue ?? '')
  if (a.type === 'SUBTASK_DONE') return t.activitySubtaskDone(a.newValue ?? '')
  if (a.type === 'SUBTASK_UNDONE') return t.activitySubtaskUndone(a.newValue ?? '')
  if (a.type === 'SUBTASK_RENAMED') return t.activitySubtaskRenamed(a.oldValue ?? '', a.newValue ?? '')
  if (a.type === 'SUBTASK_DELETED') return t.activitySubtaskDeleted(a.oldValue ?? '')
  // 详情留痕：ASSIGNED 承载显示名（空 = 取消指派）；DUE_CHANGED 承载 yyyy-MM-dd（空 = 清空）
  if (a.type === 'SUBTASK_ASSIGNED')
    return a.newValue ? t.activitySubtaskAssigned(a.newValue) : t.activitySubtaskUnassigned
  if (a.type === 'SUBTASK_DUE_CHANGED')
    return a.newValue ? t.activitySubtaskDueChanged(a.newValue) : t.activitySubtaskDueCleared
  const field = activityFieldLabel(t)[a.type]
  const oldV = humanValue(a.oldValue, t)
  const newV = humanValue(a.newValue, t)
  if (field) return t.changedField(field, oldV, newV)
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
  const t = useT()
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
        <div style={{ ...errorStyle, marginBottom: 14 }}>{t.commentsLoadFailed(apiErrorMessage(comments.error, t))}</div>
      )}
      {comments.data && comments.data.length === 0 && (
        <div style={{ ...hintStyle, marginBottom: 14 }}>{t.noComments}</div>
      )}
      {comments.data && comments.data.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
          {comments.data.map((c) => {
            const who = c.authorName ?? t.userN(c.authorId)
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
          placeholder={t.commentPlaceholder}
          aria-label={t.commentBody}
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
          {createComment.isPending ? t.sending : t.send}
        </button>
      </div>
      {createComment.isError && (
        <div style={{ ...errorStyle, marginTop: 8 }}>{t.sendFailed(apiErrorMessage(createComment.error, t))}</div>
      )}
    </div>
  )
}

// ---------- 子块：子任务（两态勾选 + 添加/删除，不进列表/看板） ----------

/** 记录图片：fetch+blob 展示（img src 带不了 Authorization），支持补传 */
function RecordImagesBlock({ slug, taskId }: { slug: string; taskId: number }) {
  const t = useT()
  const images = useTaskImages(slug, taskId)
  const [urls, setUrls] = useStateImg<Record<number, string>>({})
  const [uploading, setUploading] = useStateImg(false)

  useEffectImg(() => {
    let cancelled = false
    const metas = images.data ?? []
    metas.forEach((m) => {
      if (urls[m.id]) return
      fetchImageUrl(slug, m.id)
        .then((u) => { if (!cancelled) setUrls((cur) => ({ ...cur, [m.id]: u })) })
        .catch(() => {})
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.data, slug])

  async function onPick(files: FileList | null) {
    if (!files || uploading) return
    setUploading(true)
    for (const f of Array.from(files)) {
      if (f.size > 5 * 1024 * 1024) continue
      try {
        await uploadTaskImage(slug, taskId, f)
      } catch {
        // 单张失败不阻断其余
      }
    }
    setUploading(false)
    images.refetch()
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>{t.imagesLabel}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {(images.data ?? []).map((m) => (
          <a key={m.id} href={urls[m.id]} target="_blank" rel="noreferrer" title={m.filename}>
            <img
              src={urls[m.id]}
              alt={m.filename}
              style={{
                width: 84, height: 84, objectFit: 'cover', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--card-2)',
              }}
            />
          </a>
        ))}
        <label
          style={{
            width: 84, height: 84, borderRadius: 8, border: '1px dashed var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--faint)', fontSize: 12, cursor: 'pointer',
            opacity: uploading ? 0.5 : 1,
          }}
        >
          + {t.addImage}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={(e) => { onPick(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    </div>
  )
}

function SubtasksBlock({ slug, taskId }: { slug: string; taskId: number }) {
  const t = useT()
  const qc = useQueryClient()
  const subtasks = useSubtasks(slug, taskId)
  const createSubtask = useCreateSubtask(slug, taskId)
  const updateSubtask = useUpdateSubtask(slug, taskId)
  const deleteSubtask = useDeleteSubtask(slug, taskId)
  const members = useMembers(slug)
  const [title, setTitle] = useState('')
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const list = subtasks.data ?? []
  const doneCount = list.filter((s) => s.done).length
  const memberName = useMemo(() => {
    const m = new Map<number, string>()
    ;(members.data ?? []).forEach((u) => m.set(u.userId, u.displayName))
    return m
  }, [members.data])

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || createSubtask.isPending) return
    createSubtask.mutate(trimmed, { onSuccess: () => setTitle('') })
  }

  /** 拖拽结束：本地乐观重排，再按新邻居发 rank 锚点由后端算中点 */
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = list.findIndex((s) => s.id === active.id)
    const to = list.findIndex((s) => s.id === over.id)
    if (from < 0 || to < 0) return
    const reordered = arrayMove(list, from, to)
    qc.setQueryData(qk.subtasks(slug, taskId), reordered)
    updateSubtask.mutate({
      id: active.id as number,
      rank: { afterId: reordered[to - 1]?.id, beforeId: reordered[to + 1]?.id },
    })
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {/* 标题行 + 进度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>{t.subtasks}</span>
        {list.length > 0 && (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--faint)' }}>
            {t.subtaskProgress(doneCount, list.length)}
          </span>
        )}
      </div>

      {subtasks.isError && (
        <div style={{ ...errorStyle, marginBottom: 8 }}>{apiErrorMessage(subtasks.error, t)}</div>
      )}
      {subtasks.data && list.length === 0 && (
        <div style={{ ...hintStyle, fontSize: 12.5, marginBottom: 8 }}>{t.noSubtasks}</div>
      )}
      {list.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
              {list.map((s) => (
                <div key={s.id}>
                  <SubtaskRow
                    s={s}
                    hovered={hoveredId === s.id}
                    onHover={(on) => setHoveredId(on ? s.id : null)}
                    doneByName={s.doneBy != null ? memberName.get(s.doneBy) ?? null : null}
                    assigneeName={s.assigneeId != null ? memberName.get(s.assigneeId) ?? null : null}
                    overdue={isSubtaskOverdue(s)}
                    expanded={expandedId === s.id}
                    onToggleExpand={() =>
                      setExpandedId((cur) => (cur === s.id ? null : s.id))
                    }
                    onToggle={() => updateSubtask.mutate({ id: s.id, done: !s.done })}
                    onDelete={() => deleteSubtask.mutate(s.id)}
                  />
                  {expandedId === s.id && (
                    <SubtaskDetail
                      slug={slug}
                      s={s}
                      members={members.data ?? []}
                      onPatch={(input) => updateSubtask.mutate({ id: s.id, ...input })}
                    />
                  )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* 添加：输入框回车提交（同评论输入框风格） */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder={t.addSubtaskPlaceholder}
        aria-label={t.subtasks}
        style={{
          width: '100%',
          boxSizing: 'border-box',
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
      {createSubtask.isError && (
        <div style={{ ...errorStyle, marginTop: 6 }}>
          {t.subtaskAddFailed(apiErrorMessage(createSubtask.error, t))}
        </div>
      )}
    </div>
  )
}

/** 本地今天 yyyy-MM-dd（到期日逾期比较用；仅展示，不进业务判定） */
function todayLocalStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isSubtaskOverdue(s: Subtask): boolean {
  return !s.done && s.dueDate != null && s.dueDate < todayLocalStr()
}

/** 单条子任务：拖拽柄（hover 出现）+ 两态勾选 + 标题（完成时划线并附「由谁完成」）+ 详情展开 + 删除 */
function SubtaskRow({
  s,
  hovered,
  onHover,
  doneByName,
  assigneeName,
  overdue,
  expanded,
  onToggleExpand,
  onToggle,
  onDelete,
}: {
  s: Subtask
  hovered: boolean
  onHover: (on: boolean) => void
  doneByName: string | null
  assigneeName: string | null
  overdue: boolean
  expanded: boolean
  onToggleExpand: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
  })
  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 7px',
        borderRadius: 7,
        background: isDragging ? 'var(--card-2)' : hovered ? 'var(--card)' : 'transparent',
        opacity: isDragging ? 0.7 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t.subtaskDrag}
        title={t.subtaskDrag}
        style={{
          border: 'none',
          background: 'none',
          padding: 0,
          width: 12,
          height: 16,
          flex: 'none',
          color: 'var(--faint)',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          opacity: hovered || isDragging ? 1 : 0,
          touchAction: 'none',
        }}
      >
        <Icon name="grip" size={12} />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={s.done ? t.subtaskMarkUndone : t.subtaskMarkDone}
        title={s.done ? t.subtaskMarkUndone : t.subtaskMarkDone}
        style={{
          width: 16,
          height: 16,
          flex: 'none',
          borderRadius: '50%',
          border: `1.5px solid ${s.done ? 'var(--accent)' : 'var(--border)'}`,
          background: s.done ? 'var(--accent)' : 'transparent',
          color: '#fff',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {s.done && <Icon name="check" size={10} />}
      </button>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.45,
          color: s.done ? 'var(--faint)' : 'var(--text)',
          textDecoration: s.done ? 'line-through' : 'none',
        }}
      >
        {s.title}
        {(assigneeName || s.dueDate) && (
          <span
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 2,
              fontSize: 11,
              textDecoration: 'none',
              color: 'var(--faint)',
              flexWrap: 'wrap',
            }}
          >
            {assigneeName && (
              <span
                style={{
                  padding: '0 6px',
                  borderRadius: 6,
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                }}
              >
                {assigneeName}
              </span>
            )}
            {s.dueDate && (
              <span
                style={{
                  padding: '0 6px',
                  borderRadius: 6,
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  color: overdue ? 'var(--type-bug)' : 'var(--faint)',
                }}
              >
                {s.dueDate}
                {overdue ? ` · ${t.subtaskOverdue}` : ''}
              </span>
            )}
          </span>
        )}
        {s.done && doneByName && (
          <span
            style={{
              display: 'block',
              fontSize: 11,
              textDecoration: 'none',
              color: 'var(--faint)',
              marginTop: 1,
            }}
          >
            {t.subtaskDoneBy(doneByName)}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onToggleExpand}
        aria-label={expanded ? t.subtaskCollapse : t.subtaskDetail}
        title={expanded ? t.subtaskCollapse : t.subtaskDetail}
        className="icon-btn"
        style={{
          border: 'none',
          background: 'none',
          padding: 0,
          width: 16,
          height: 16,
          flex: 'none',
          color: expanded ? 'var(--accent)' : 'var(--dim)',
          cursor: 'pointer',
          display: 'flex',
          opacity: hovered || expanded ? 1 : 0,
          transform: expanded ? 'rotate(180deg)' : 'none',
        }}
      >
        <Icon name="chevron" size={14} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t.subtaskDelete}
        title={t.subtaskDelete}
        className="icon-btn"
        style={{
          border: 'none',
          background: 'none',
          padding: 0,
          width: 16,
          height: 16,
          flex: 'none',
          color: 'var(--dim)',
          cursor: 'pointer',
          display: 'flex',
          opacity: hovered ? 1 : 0,
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}

/** 子任务详情（内联展开）：描述（blur 保存）/ 负责人 / 到期日 / 图片附件。每项改动即 PATCH /subtasks/{id}。 */
function SubtaskDetail({
  slug,
  s,
  members,
  onPatch,
}: {
  slug: string
  s: Subtask
  members: Member[]
  onPatch: (input: { description?: string | null; assigneeId?: number | null; dueDate?: string | null }) => void
}) {
  const t = useT()
  return (
    <div
      style={{
        margin: '2px 0 8px 34px',
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <textarea
        defaultValue={s.description ?? ''}
        placeholder={t.subtaskDescriptionPlaceholder}
        aria-label={t.fieldDescription}
        rows={3}
        onBlur={(e) => {
          const v = e.target.value
          if (v !== (s.description ?? '')) onPatch({ description: v === '' ? null : v })
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--card-2)',
          color: 'var(--text)',
          fontSize: 12.5,
          lineHeight: 1.5,
          padding: '7px 10px',
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dim)' }}>
          {t.assignee}
          <SelectWrap>
            <select
              aria-label={t.assignee}
              value={s.assigneeId != null ? String(s.assigneeId) : ''}
              onChange={(e) =>
                onPatch({ assigneeId: e.target.value ? Number(e.target.value) : null })
              }
              style={{ ...selStyle, fontSize: 12.5 }}
            >
              <option value="">{t.unassigned}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </SelectWrap>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dim)' }}>
          {t.subtaskDueDate}
          <input
            type="date"
            aria-label={t.subtaskDueDate}
            value={s.dueDate ?? ''}
            onChange={(e) => onPatch({ dueDate: e.target.value || null })}
            style={{
              height: 28,
              borderRadius: 7,
              border: '1px solid var(--border)',
              background: 'var(--card-2)',
              color: isSubtaskOverdue(s) ? 'var(--type-bug)' : 'var(--text)',
              fontSize: 12.5,
              padding: '0 8px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </label>
      </div>
      <SubtaskAttachmentsBlock slug={slug} subtaskId={s.id} />
    </div>
  )
}

/** 子任务附件：图片显示缩略图，文档显示文件芯片；fetch+blob 展示（img src 带不了 Authorization） */
function SubtaskAttachmentsBlock({ slug, subtaskId }: { slug: string; subtaskId: number }) {
  const t = useT()
  const images = useSubtaskImages(slug, subtaskId)
  const [urls, setUrls] = useStateImg<Record<number, string>>({})
  const [uploading, setUploading] = useStateImg(false)

  useEffectImg(() => {
    let cancelled = false
    const metas = images.data ?? []
    metas.forEach((m) => {
      if (urls[m.id]) return
      fetchSubtaskImageUrl(slug, m.id)
        .then((u) => { if (!cancelled) setUrls((cur) => ({ ...cur, [m.id]: u })) })
        .catch(() => {})
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.data, slug])

  async function onPick(files: FileList | null) {
    if (!files || uploading) return
    setUploading(true)
    for (const f of Array.from(files)) {
      if (f.size > 5 * 1024 * 1024) continue
      try {
        await uploadSubtaskImage(slug, subtaskId, f)
      } catch {
        // 单个失败不阻断其余
      }
    }
    setUploading(false)
    images.refetch()
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>{t.subtaskAttachments}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {(images.data ?? []).map((m) =>
          m.contentType.startsWith('image/') ? (
            <a key={m.id} href={urls[m.id]} target="_blank" rel="noreferrer" title={m.filename}>
              <img
                src={urls[m.id]}
                alt={m.filename}
                style={{
                  width: 64, height: 64, objectFit: 'cover', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--card-2)',
                }}
              />
            </a>
          ) : (
            <a
              key={m.id}
              href={urls[m.id]}
              target="_blank"
              rel="noreferrer"
              title={m.filename}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: 180,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--card-2)',
                color: 'var(--text)',
                fontSize: 12,
                textDecoration: 'none',
              }}
            >
              <Icon name="file" size={14} style={{ flex: 'none', color: 'var(--dim)' }} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.filename}
              </span>
            </a>
          )
        )}
        <label
          style={{
            width: 64, height: 64, borderRadius: 8, border: '1px dashed var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--faint)', fontSize: 11, cursor: 'pointer', textAlign: 'center',
            opacity: uploading ? 0.5 : 1,
          }}
        >
          + {t.addAttachment}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
            multiple
            onChange={(e) => { onPick(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    </div>
  )
}

// ---------- 子块：变更历史（时间线 + via MCP 标记） ----------

function ActivitiesTab({ slug, taskId }: { slug: string; taskId: number }) {
  const t = useT()
  const activities = useActivities(slug, taskId)
  if (activities.isLoading) return <SkeletonLines rows={3} />
  if (activities.isError)
    return <div style={errorStyle}>{t.historyLoadFailed(apiErrorMessage(activities.error, t))}</div>
  const list = activities.data ?? []
  if (list.length === 0) return <div style={hintStyle}>{t.noHistory}</div>
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
              <b style={{ fontWeight: 600 }}>{activityWho(a, t)}</b> {activityText(a, t)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2 }}>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{formatTime(a.at)}</span>
              {(a.source === 'MCP' || a.source === 'AGENT') && (
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
                  {a.source === 'AGENT' ? t.viaAgent : t.viaMcp}
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
  const { locale } = useI18n()
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'
  const taskQuery = useTask(slug, seed.id)
  const updateTask = useUpdateTask(slug)
  const deleteTask = useDeleteTask(slug)
  const members = useMembers(slug)
  const epics = useEpics(slug, projectKey)
  const sprintsQuery = useSprints(slug, projectKey)
  const t = useT()
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

  // Esc 关闭（编辑中先 blur，第二次 Esc 才关闭，避免丢未保存内容）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        ;(active as HTMLElement).blur()
        return
      }
      onClose()
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

  // 迭代下拉：待办（空）+ 进行中/计划中的迭代；任务已挂在已关闭迭代上时也把它列出来以便正确显示
  const sprintChoices = useMemo(() => {
    const list = ((sprintsQuery.data ?? []) as Sprint[]).filter(
      (s) => s.status !== 'CLOSED' || s.id === task.sprintId,
    )
    return [...list].sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [sprintsQuery.data, task.sprintId])

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
        aria-label={t.taskDetail(displayId)}
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
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>{t.savingTask}</span>
          )}
          {updateTask.isError && (
            <span style={{ fontSize: 11, color: 'var(--type-bug)' }}>
              {isConflictError(updateTask.error)
                ? t.conflictError
                : t.saveFailed(apiErrorMessage(updateTask.error, t))}
            </span>
          )}
          {deleteTask.isError && (
            <span style={{ fontSize: 11, color: 'var(--type-bug)' }}>
              {t.deleteFailed(apiErrorMessage(deleteTask.error, t))}
            </span>
          )}
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={t.deleteTask}
              className="icon-btn"
              title={t.deleteTask}
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
              <span style={{ fontSize: 11, color: 'var(--type-bug)' }}>{t.confirmDelete}</span>
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
                {deleteTask.isPending ? t.deleting : t.delete}
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
                {t.cancel}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
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
            aria-label={t.taskTitle}
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
            <span style={dimLabelStyle}>{t.status}</span>
            <SelectWrap>
              <select
                aria-label={t.status}
                value={task.status}
                onChange={(e) => patch({ status: e.target.value as TaskStatus })}
                style={{ ...selStyle, color: statusColor(task.status), fontWeight: 600 }}
              >
                {statusOptions(t).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SelectWrap>

            <span style={dimLabelStyle}>{t.type}</span>
            <SelectWrap>
              <select
                aria-label={t.type}
                value={task.type}
                onChange={(e) => patch({ type: e.target.value as TaskType })}
                style={selStyle}
              >
                {typeOptions(t).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SelectWrap>

            {task.type !== 'RECORD' && (<>
            <span style={dimLabelStyle}>{t.points}</span>
            <SelectWrap>
              <select
                aria-label={t.points}
                value={pointsValue}
                onChange={(e) =>
                  patch({ points: e.target.value ? Number(e.target.value) : null })
                }
                style={selStyle}
              >
                <option value="">{t.noPoints}</option>
                {pointsChoices.map((p) => (
                  <option key={p} value={String(p)}>
                    {fmtPoints(p)} {t.ptsUnit}
                  </option>
                ))}
              </select>
            </SelectWrap>
            </>)}

            <span style={dimLabelStyle}>{t.assignee}</span>
            <SelectWrap>
              <select
                aria-label={t.assignee}
                value={task.assigneeId != null ? String(task.assigneeId) : ''}
                onChange={(e) =>
                  patch({ assigneeId: e.target.value ? Number(e.target.value) : null })
                }
                style={selStyle}
              >
                <option value="">{t.unassigned}</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </SelectWrap>

            {task.type !== 'RECORD' && (<>
            <span style={dimLabelStyle}>{t.fieldSprint}</span>
            <SelectWrap>
              <select
                aria-label={t.fieldSprint}
                value={task.sprintId != null ? String(task.sprintId) : ''}
                onChange={(e) => patch({ sprintId: e.target.value ? Number(e.target.value) : null })}
                style={selStyle}
              >
                <option value="">{t.backlog}</option>
                {sprintChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.status === 'ACTIVE' ? `（${t.sprintInProgress}）` : s.status === 'CLOSED' ? `（${t.sprintEnded}）` : ''}
                  </option>
                ))}
              </select>
            </SelectWrap>
            </>)}

            <span style={dimLabelStyle}>{t.epic}</span>
            <SelectWrap>
              <select
                aria-label={t.epic}
                value={task.epicId != null ? String(task.epicId) : ''}
                onChange={(e) => patch({ epicId: e.target.value ? Number(e.target.value) : null })}
                style={selStyle}
              >
                <option value="">{t.none}</option>
                {(epics.data ?? []).map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>

          {/* 描述 */}
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>{t.description}</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={4}
            placeholder={t.descriptionPlaceholder2}
            aria-label={t.description}
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

          {/* 记录：图片 + 提醒信息 */}
          {task.type === 'RECORD' && (
            <>
              <RecordImagesBlock slug={slug} taskId={seed.id} />
              <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
                {task.remindAt
                  ? `${t.remindAtLabel}：${new Date(task.remindAt).toLocaleString(dateLocale)}${task.reminderDismissed ? `（${t.reminderDone}）` : ''}`
                  : t.noReminder}
              </div>
            </>
          )}

          {/* 子任务 */}
          <SubtasksBlock slug={slug} taskId={seed.id} />

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
                { key: 'comments', label: t.tabComments },
                { key: 'activities', label: t.tabHistory },
              ] as const
            ).map((tb) => (
              <button
                key={tb.key}
                role="tab"
                aria-selected={tab === tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                style={tabStyle(tab === tb.key)}
              >
                {tb.label}
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
