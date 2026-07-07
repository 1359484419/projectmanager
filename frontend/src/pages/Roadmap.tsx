// Roadmap：按季度分组的 Epic 路线图。
// 数据：GET /api/t/{slug}/projects/{key}/roadmap（useRoadmap，后端已按季度分组）。
// 项目选择：?project=KEY 查询参数，缺省取项目列表第一个（与 Dashboard 一致）。
import { useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useCreateEpic, useProjects, useRoadmap } from '../api/hooks'
import type { TaskBrief } from '../api/types'
import EpicCard from '../components/EpicCard'
import TaskDrawer from '../components/TaskDrawer'

/** 当前及后续 3 个季度选项，如 "2026-Q3" */
function quarterOptions(): string[] {
  const now = new Date()
  let year = now.getFullYear()
  let q = Math.floor(now.getMonth() / 3) + 1
  const out: string[] = []
  for (let i = 0; i < 4; i++) {
    out.push(`${year}-Q${q}`)
    q += 1
    if (q > 4) {
      q = 1
      year += 1
    }
  }
  return out
}

const EPIC_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7']

/** 新建 Epic 对话框 */
function CreateEpicDialog({
  slug,
  projectKey,
  onClose,
}: {
  slug: string
  projectKey: string
  onClose: () => void
}) {
  const createEpic = useCreateEpic(slug, projectKey)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [quarter, setQuarter] = useState('')
  const [color, setColor] = useState(EPIC_COLORS[0])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || createEpic.isPending) return
    createEpic.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        quarter: quarter || undefined,
        color,
      },
      { onSuccess: onClose },
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 4,
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新建 Epic"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: '90vw',
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>新建 Epic</h2>
        <div>
          <label style={labelStyle} htmlFor="epic-name">
            名称 *
          </label>
          <input
            id="epic-name"
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="epic-desc">
            描述
          </label>
          <textarea
            id="epic-desc"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="epic-quarter">
            季度
          </label>
          <select
            id="epic-quarter"
            style={inputStyle}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
          >
            <option value="">暂不指定</option>
            {quarterOptions().map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span style={labelStyle}>颜色</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {EPIC_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`颜色 ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: c,
                  border: c === color ? '3px solid #111827' : '3px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
        {createEpic.isError && (
          <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>
            创建失败：{createEpic.error.message}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!name.trim() || createEpic.isPending}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: !name.trim() || createEpic.isPending ? 0.6 : 1,
            }}
          >
            {createEpic.isPending ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Roadmap() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const projects = useProjects(slug)
  const projectKey = searchParams.get('project') ?? projects.data?.[0]?.key ?? ''
  const roadmap = useRoadmap(slug, projectKey)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)

  if (projects.isLoading || (projectKey && roadmap.isLoading)) {
    return <p style={{ padding: 24, color: '#6b7280' }}>加载中…</p>
  }
  if (projects.isError) {
    return <p style={{ padding: 24, color: '#b91c1c' }}>项目列表加载失败：{projects.error.message}</p>
  }
  if (!projectKey) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Roadmap</h1>
        <p style={{ color: '#6b7280' }}>当前租户还没有项目，请先创建项目。</p>
      </div>
    )
  }
  if (roadmap.isError) {
    return <p style={{ padding: 24, color: '#b91c1c' }}>路线图加载失败：{roadmap.error.message}</p>
  }

  const groups = roadmap.data ?? []
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Roadmap · {projectKey}</h1>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          style={{
            marginLeft: 'auto',
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#4f46e5',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          新建 Epic
        </button>
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            border: '1px dashed #d1d5db',
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
            color: '#6b7280',
          }}
        >
          还没有 Epic，点击右上角「新建 Epic」开始规划路线图。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {groups.map((group) => (
            <section key={group.quarter ?? '__none__'}>
              <h2
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#374151',
                  margin: '0 0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {group.quarter ?? '未指定季度'}
                <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af' }}>
                  {group.epics.length} 个 Epic
                </span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {group.epics.map((epic) => (
                  <EpicCard
                    key={epic.id}
                    epic={epic}
                    projectKey={projectKey}
                    onTaskClick={setDrawerTask}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {dialogOpen && (
        <CreateEpicDialog slug={slug} projectKey={projectKey} onClose={() => setDialogOpen(false)} />
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
