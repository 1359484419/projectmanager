import { useEffect, useState } from 'react'
import { useCreateTask, useEpics, useMembers, useSprints } from '../api/hooks'
import type { Sprint, TaskType } from '../api/types'
import { Icon } from './icons'
import { SelectWrap, selStyle, TYPE_OPTIONS, useToast } from './ui'
import { POINTS_CHOICES, POINTS_RANGE_MSG, fmtPoints, parsePointsInput } from '../utils/points'

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
  const [sprintTarget, setSprintTarget] = useState<'current' | 'backlog'>('backlog')
  const [epicId, setEpicId] = useState('')

  const createTask = useCreateTask(slug, projectKey)
  const members = useMembers(slug)
  const sprints = useSprints(slug, projectKey)
  const epics = useEpics(slug, projectKey)
  const toast = useToast()

  const activeSprint = pickActiveSprint(sprints.data as Sprint[] | undefined)

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
      toast.show(POINTS_RANGE_MSG, 'info')
      return
    }

    createTask.mutate(
      {
        type,
        title: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parsedPoints != null ? { points: parsedPoints } : {}),
        ...(assigneeId ? { assigneeId: Number(assigneeId) } : {}),
        ...(sprintTarget === 'current' && activeSprint ? { sprintId: activeSprint.id } : {}),
        ...(epicId ? { epicId: Number(epicId) } : {}),
      },
      {
        onSuccess: (created) => {
          toast.show(`已创建 ${projectKey}-${created.seq}`)
          onClose()
        },
        onError: (err) =>
          toast.show(`创建失败：${err instanceof Error ? err.message : '未知错误'}`, 'info'),
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
        aria-label="新建任务"
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
          <h2 style={{ fontSize: 15, fontWeight: 650, margin: 0, flex: 1 }}>新建任务</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
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
              <label style={labelStyle}>类型</label>
              <SelectWrap>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as TaskType)}
                  style={{ ...selStyle, height: 34 }}
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>标题 *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="任务标题"
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
            <label style={labelStyle}>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充描述（可选）"
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
              <label style={labelStyle}>Points</label>
              <SelectWrap>
                <select
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">未估点</option>
                  {POINTS_CHOICES.map((p) => (
                    <option key={p} value={String(p)}>{fmtPoints(p)} pts</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>负责人</label>
              <SelectWrap>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">未分配</option>
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
              <label style={labelStyle}>挂载到</label>
              <SelectWrap>
                <select
                  value={sprintTarget}
                  onChange={(e) => setSprintTarget(e.target.value as 'current' | 'backlog')}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="backlog">Backlog</option>
                  {activeSprint && (
                    <option value="current">{activeSprint.name}（当前）</option>
                  )}
                </select>
              </SelectWrap>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Epic</label>
              <SelectWrap>
                <select
                  value={epicId}
                  onChange={(e) => setEpicId(e.target.value)}
                  style={{ ...selStyle, height: 34 }}
                >
                  <option value="">无</option>
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
              取消
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
              {createTask.isPending ? '创建中…' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
