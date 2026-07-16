import { useEffect, useState } from 'react'
import { useCreateTask, useEpics, useMembers, useSprints } from '../api/hooks'
import type { Sprint, TaskType } from '../api/types'
import { useT } from '../i18n'
import { Icon } from './icons'
import { SelectWrap, selStyle, typeOptions, useToast } from './ui'
import { POINTS_CHOICES, fmtPoints, parsePointsInput } from '../utils/points'

export interface CreateTaskDialogProps {
  slug: string
  projectKey: string
  onClose: () => void
}

function pickActiveSprint(sprints: Sprint[] | undefined): Sprint | null {
  return sprints?.find((s) => s.status === 'ACTIVE') ?? null
}

export default function CreateTaskDialog({ slug, projectKey, onClose }: CreateTaskDialogProps) {
  const [type, setType] = useState<TaskType>('STORY')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  // '' = Backlog，否则为具体 sprintId（PLANNED/ACTIVE 都可选，非必选）
  const [sprintId, setSprintId] = useState('')
  const [epicId, setEpicId] = useState('')

  const createTask = useCreateTask(slug, projectKey)
  const members = useMembers(slug)
  const sprints = useSprints(slug, projectKey)
  const epics = useEpics(slug, projectKey)
  const toast = useToast()
  const t = useT()

  const activeSprint = pickActiveSprint(sprints.data as Sprint[] | undefined)
  // 可选目标：ACTIVE 在前，其后 PLANNED（新的在前）；CLOSED 不可选
  const selectableSprints = ((sprints.data as Sprint[] | undefined) ?? []).filter(
    (s) => s.status !== 'CLOSED',
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || createTask.isPending) return

    const parsedPoints = parsePointsInput(points)
    if (parsedPoints === undefined) {
      toast.show(t.pointsRangeMsg, 'info')
      return
    }

    createTask.mutate(
      {
        type,
        title: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parsedPoints != null ? { points: parsedPoints } : {}),
        ...(assigneeId ? { assigneeId: Number(assigneeId) } : {}),
        ...(sprintId ? { sprintId: Number(sprintId) } : {}),
        ...(epicId ? { epicId: Number(epicId) } : {}),
      },
      {
        onSuccess: (created) => {
          toast.show(t.taskCreated(`${projectKey}-${created.seq}`))
          onClose()
        },
        onError: (err) =>
          toast.show(t.createFailed(err instanceof Error ? err.message : t.unknownError), 'info'),
      },
    )
  }

  const labelStyle = { fontSize: 12, color: 'var(--dim)', marginBottom: 4, display: 'block' } as const

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
        aria-label={t.createTaskTitle}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 460,
          maxWidth: '92vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          zIndex: 61,
          boxShadow: '0 20px 60px -12px rgba(0,0,0,.7)',
          animation: 'fadeIn .15s ease',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px 0',
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 650, margin: 0, flex: 1 }}>{t.createTaskTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="icon-btn"
            style={{ border: 'none', background: 'none', padding: 0, width: 16, height: 16, color: 'var(--dim)', cursor: 'pointer', display: 'flex' }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submit() }}
          style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* 类型 + 标题 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 'none' }}>
              <label style={labelStyle}>{t.type}</label>
              <SelectWrap>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as TaskType)}
                  style={{ ...selStyle, height: 34 }}
                >
                  {typeOptions(t).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>{t.titleRequired}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.taskTitlePlaceholder}
                autoFocus
                style={{
                  width: '100%',
                  height: 34,
                  boxSizing: 'border-box',
                  borderRadius: 7,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--text)',
                  fontSize: 13,
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label style={labelStyle}>{t.description}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.descriptionPlaceholder}
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--text)',
                fontSize: 13,
                padding: '8px 10px',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* 属性行：Points + 负责人 */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t.points}</label>
              <SelectWrap>
                <select
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">{t.noPoints}</option>
                  {POINTS_CHOICES.map((p) => (
                    <option key={p} value={String(p)}>{fmtPoints(p)} pts</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t.assignee}</label>
              <SelectWrap>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">{t.unassigned}</option>
                  {(members.data ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>{m.displayName}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          </div>

          {/* 属性行：Sprint 目标 + Epic */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t.target}</label>
              <SelectWrap>
                <select
                  value={sprintId}
                  onChange={(e) => setSprintId(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">{t.backlog}</option>
                  {selectableSprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id === activeSprint?.id ? t.currentSprint(s.name) : s.name}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t.epic}</label>
              <SelectWrap>
                <select
                  value={epicId}
                  onChange={(e) => setEpicId(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">{t.none}</option>
                  {(epics.data ?? []).map((ep) => (
                    <option key={ep.id} value={ep.id}>{ep.name}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          </div>

          {/* 提交 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 34,
                padding: '0 16px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--dim)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createTask.isPending}
              className="btn-primary"
              style={{
                height: 34,
                padding: '0 20px',
                borderRadius: 7,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: !title.trim() || createTask.isPending ? 0.55 : 1,
              }}
            >
              {createTask.isPending ? t.creating : t.create}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
