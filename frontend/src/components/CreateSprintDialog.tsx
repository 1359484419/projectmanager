// 新建迭代弹窗：名称（留空自动编号）、周期（默认项目周期）、开始日期（默认最晚现有迭代结束日+1，否则今天）。
// 从 AllSprints 抽出，供概览「去创建迭代」与规划页空态直接打开，避免把用户踢到别的页面。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useCreateSprint, useProjects, useSprints } from '../api/hooks'
import { apiErrorMessage } from '../api/errors'
import type { Sprint, SprintLength } from '../api/types'
import { useT } from '../i18n'
import { SelectWrap, btnGhost, btnPrimary, inputStyle, labelStyle, selStyle, useToast } from './ui'

function sprintLengths(t: { sprintLength1w: string; sprintLength2w: string; sprintLength1m: string }) {
  return [
    { value: 'WEEK_1' as SprintLength, label: t.sprintLength1w },
    { value: 'WEEK_2' as SprintLength, label: t.sprintLength2w },
    { value: 'MONTH_1' as SprintLength, label: t.sprintLength1m },
  ]
}

export default function CreateSprintDialog({
  slug,
  projectKey,
  onClose,
  onCreated,
}: {
  slug: string
  projectKey: string
  onClose: () => void
  onCreated?: (sprint: Sprint) => void
}) {
  const t = useT()
  const toast = useToast()
  const { data: projects } = useProjects(slug)
  const project = projects?.find((p) => p.key === projectKey)
  // 复用各页面已有的 sprints 缓存（withTasks=false）算默认开始日期
  const { data: sprints } = useSprints(slug, projectKey)
  const createSprint = useCreateSprint(slug, projectKey)
  const defaultStart = useMemo(() => {
    const latestEnd = ((sprints ?? []) as Sprint[]).reduce<string | null>(
      (max, s) => (max === null || s.endDate > max ? s.endDate : max),
      null,
    )
    if (!latestEnd) return new Date().toISOString().slice(0, 10)
    const d = new Date(latestEnd)
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [sprints])
  const [name, setName] = useState('')
  const [length, setLength] = useState<SprintLength | ''>('')
  const [startDate, setStartDate] = useState('')
  const effectiveLength: SprintLength = length || project?.defaultSprintLength || 'WEEK_2'
  const effectiveStart = startDate || defaultStart

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (createSprint.isPending) return
    createSprint.mutate(
      { name: name.trim() || undefined, length: effectiveLength, startDate: effectiveStart },
      {
        onSuccess: (s) => {
          toast.show(t.sprintCreated(s.name))
          onCreated?.(s)
          onClose()
        },
        onError: (err) => toast.show(t.createFailed(apiErrorMessage(err, t)), 'info'),
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.createSprintDialogTitle}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.5)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn .12s',
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: '92vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow)',
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 16 }}>{t.createSprintDialogTitle}</div>

        <label style={labelStyle} htmlFor="sprint-name">
          {t.sprintNameLabel}
        </label>
        <input
          id="sprint-name"
          style={{ ...inputStyle, marginBottom: 14 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.sprintNamePlaceholder}
          autoFocus
        />

        <label style={labelStyle} htmlFor="sprint-length">
          {t.sprintLengthLabel}
        </label>
        <SelectWrap style={{ marginBottom: 14 }}>
          <select
            id="sprint-length"
            style={selStyle}
            value={effectiveLength}
            onChange={(e) => setLength(e.target.value as SprintLength)}
          >
            {sprintLengths(t).map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </SelectWrap>

        <label style={labelStyle} htmlFor="sprint-start">
          {t.sprintStartDateLabel}
        </label>
        <input
          id="sprint-start"
          type="date"
          style={{ ...inputStyle, marginBottom: 20 }}
          value={effectiveStart}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button type="button" onClick={onClose} style={btnGhost} className="hover-card">
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={createSprint.isPending}
            className="btn-primary"
            style={{
              ...btnPrimary,
              height: 32,
              padding: '0 16px',
              borderRadius: 8,
              opacity: createSprint.isPending ? 0.6 : 1,
            }}
          >
            {createSprint.isPending ? t.creating : t.create}
          </button>
        </div>
      </form>
    </div>
  )
}
