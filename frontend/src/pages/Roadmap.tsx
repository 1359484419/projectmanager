// Roadmap：按季度分组的 Epic 路线图。
// 视觉真源：docs/design/mock/markup.html ROADMAP + EPIC MODAL 节。
// 数据：GET /api/t/{slug}/projects/{key}/roadmap（useRoadmap，后端已按季度分组）。
// 项目选择：?project=KEY 深链优先 → 顶栏切换器选中的项目 → 第一个（与 Dashboard 一致）。
import { useState, type CSSProperties, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useCreateEpic, useProjects, useRoadmap } from '../api/hooks'
import type { TaskBrief } from '../api/types'
import EpicCard from '../components/EpicCard'
import TaskDrawer from '../components/TaskDrawer'
import { Icon } from '../components/icons'
import {
  SelectWrap,
  btnGhost,
  btnPrimary,
  btnSecondary,
  inputStyle,
  labelStyle,
  pageTitleStyle,
  selStyle,
  useToast,
} from '../components/ui'
import { resolveProjectKey, useSelectedProjectKey } from '../state/selectedProject'

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

/** Epic 色板（设计稿 logic.jsx epicPalette） */
const EPIC_COLORS = ['#6e79d6', '#3f9d6b', '#d1a03a', '#c74d8a', '#4aa3c9', '#d6673f']

/** 页面滚动容器（设计稿主区：flex:1 + 内滚 + 20/24/40 内边距） */
const pageStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '20px 24px 40px',
}

/** 新建 Epic 模态（设计稿 EPIC MODAL 节） */
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
  const toast = useToast()
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
      {
        onSuccess: () => {
          toast.show('Epic 已创建')
          onClose()
        },
        onError: (err) => {
          toast.show(`创建失败：${err.message}`, 'info')
        },
      },
    )
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
          width: 440,
          maxWidth: '92vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow)',
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 16 }}>新建 Epic</div>

        <label style={labelStyle} htmlFor="epic-name">
          名称
        </label>
        <input
          id="epic-name"
          style={{ ...inputStyle, marginBottom: 14 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：搜索体验"
          autoFocus
          required
        />

        <label style={labelStyle} htmlFor="epic-desc">
          描述
        </label>
        <textarea
          id="epic-desc"
          style={{
            ...inputStyle,
            height: 'auto',
            minHeight: 60,
            padding: '8px 11px',
            resize: 'vertical',
            fontFamily: 'inherit',
            marginBottom: 14,
            boxSizing: 'border-box',
          }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <label style={{ ...labelStyle, marginBottom: 7 }}>颜色</label>
        <div style={{ display: 'flex', gap: 9, marginBottom: 16 }}>
          {EPIC_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`颜色 ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: c,
                cursor: 'pointer',
                border: `2px solid ${c === color ? 'var(--text)' : 'transparent'}`,
                boxShadow: '0 0 0 2px var(--bg) inset',
                transition: '.1s',
                padding: 0,
              }}
            />
          ))}
        </div>

        <label style={labelStyle} htmlFor="epic-quarter">
          季度
        </label>
        <SelectWrap style={{ marginBottom: 20 }}>
          <select
            id="epic-quarter"
            style={selStyle}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
          >
            {quarterOptions().map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
            <option value="">未指定</option>
          </select>
        </SelectWrap>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button type="button" onClick={onClose} style={btnGhost} className="hover-card">
            取消
          </button>
          <button
            type="submit"
            disabled={!name.trim() || createEpic.isPending}
            className="btn-primary"
            style={{
              ...btnPrimary,
              height: 32,
              padding: '0 16px',
              borderRadius: 8,
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

/** 加载骨架：标题行 + 两个季度分组的卡片骨架（styles.css .sk shimmer） */
function RoadmapSkeleton() {
  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <span className="sk" style={{ width: 96, height: 20 }} />
        <span style={{ flex: 1 }} />
        <span className="sk" style={{ width: 92, height: 30 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {[0, 1].map((g) => (
          <div key={g}>
            <span className="sk" style={{ width: 72, height: 12, display: 'block', marginBottom: 10 }} />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))',
                gap: 12,
              }}
            >
              {[0, 1].map((c) => (
                <span key={c} className="sk" style={{ height: 140, borderRadius: 11 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PageMessage({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div style={pageStyle}>
      <p style={{ fontSize: 13, color: error ? 'var(--type-bug)' : 'var(--dim)', margin: 0 }}>
        {children}
      </p>
    </div>
  )
}

export default function Roadmap() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const projects = useProjects(slug)
  const storedProjectKey = useSelectedProjectKey(slug)
  const projectKey = resolveProjectKey(searchParams.get('project'), storedProjectKey, projects.data)
  const roadmap = useRoadmap(slug, projectKey)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)

  if (projects.isLoading || (projectKey && roadmap.isLoading)) {
    return <RoadmapSkeleton />
  }
  if (projects.isError) {
    return <PageMessage error>项目列表加载失败：{projects.error.message}</PageMessage>
  }
  if (!projectKey) {
    return (
      <div style={pageStyle}>
        <h1 style={{ ...pageTitleStyle, marginBottom: 8 }}>路线图</h1>
        <p style={{ fontSize: 13, color: 'var(--dim)', margin: 0 }}>
          当前租户还没有项目，请先创建项目。
        </p>
      </div>
    )
  }
  if (roadmap.isError) {
    return <PageMessage error>路线图加载失败：{roadmap.error.message}</PageMessage>
  }

  const groups = roadmap.data ?? []
  return (
    <div style={pageStyle}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={pageTitleStyle}>路线图</h1>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="hover-card"
          style={{ ...btnSecondary, padding: '0 12px 0 9px' }}
        >
          <Icon name="plus" size={14} />
          新建 Epic
        </button>
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border-strong)',
            borderRadius: 11,
            padding: '48px 24px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--dim)',
          }}
        >
          还没有 Epic，点击右上角「新建 Epic」开始规划路线图。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {groups.map((group) => (
            <section key={group.quarter ?? '__none__'}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  marginBottom: 10,
                }}
              >
                {group.quarter ?? '未指定季度'}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))',
                  gap: 12,
                  alignItems: 'start',
                }}
              >
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
