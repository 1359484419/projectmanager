// Roadmap：按季度分组的 Epic 路线图。
// 视觉真源：docs/design/mock/markup.html ROADMAP + EPIC MODAL 节。
// 数据：GET /api/t/{slug}/projects/{key}/roadmap（useRoadmap，后端已按季度分组）。
// 项目选择：?project=KEY 深链优先 → 顶栏切换器选中的项目 → 第一个（与 Dashboard 一致）。
import { useState, type CSSProperties, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useCreateEpic, useEpics, useProjects, useRoadmap, useUpdateEpic } from '../api/hooks'
import type { Epic, RoadmapEpic, TaskBrief } from '../api/types'
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
import { useT } from '../i18n'

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

/** Epic 模态（设计稿 EPIC MODAL 节）：不传 epic 为新建，传 epic 为编辑（多状态下拉） */
function EpicDialog({
  slug,
  projectKey,
  epic,
  onClose,
}: {
  slug: string
  projectKey: string
  /** 编辑模式：回填该 Epic 并走 PATCH */
  epic?: Epic
  onClose: () => void
}) {
  const t = useT()
  const createEpic = useCreateEpic(slug, projectKey)
  const updateEpic = useUpdateEpic(slug, projectKey)
  const toast = useToast()
  const [name, setName] = useState(epic?.name ?? '')
  const [description, setDescription] = useState(epic?.description ?? '')
  const [quarter, setQuarter] = useState(epic?.quarter ?? '')
  const [color, setColor] = useState(epic?.color || EPIC_COLORS[0])
  const [status, setStatus] = useState(epic?.status ?? 'OPEN')
  const isEdit = !!epic
  const isPending = isEdit ? updateEpic.isPending : createEpic.isPending
  // 编辑时：旧 Epic 的季度/颜色可能不在当前候选里，补进去以便正确回显
  const quarters = quarterOptions()
  if (epic?.quarter && !quarters.includes(epic.quarter)) quarters.unshift(epic.quarter)
  const colors =
    epic?.color && !EPIC_COLORS.includes(epic.color) ? [epic.color, ...EPIC_COLORS] : EPIC_COLORS

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || isPending) return
    if (isEdit) {
      updateEpic.mutate(
        {
          id: epic.id,
          name: name.trim(),
          description: description.trim() || null,
          quarter: quarter || null,
          color,
          status,
        },
        {
          onSuccess: () => {
            toast.show(t.epicUpdated)
            onClose()
          },
          onError: (err) => {
            toast.show(t.epicUpdateFailed(err.message), 'info')
          },
        },
      )
      return
    }
    createEpic.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        quarter: quarter || undefined,
        color,
      },
      {
        onSuccess: () => {
          toast.show(t.epicCreated)
          onClose()
        },
        onError: (err) => {
          toast.show(t.createFailed(err.message), 'info')
        },
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? t.editEpic : t.createEpic}
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
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 16 }}>
          {isEdit ? t.editEpic : t.createEpic}
        </div>

        <label style={labelStyle} htmlFor="epic-name">
          {t.epicName}
        </label>
        <input
          id="epic-name"
          style={{ ...inputStyle, marginBottom: 14 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.epicNamePlaceholder}
          autoFocus
          required
        />

        <label style={labelStyle} htmlFor="epic-desc">
          {t.epicDescription}
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

        <label style={{ ...labelStyle, marginBottom: 7 }}>{t.epicColor}</label>
        <div style={{ display: 'flex', gap: 9, marginBottom: 16 }}>
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={t.epicColorAria(c)}
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
          {t.epicQuarter}
        </label>
        <SelectWrap style={{ marginBottom: 20 }}>
          <select
            id="epic-quarter"
            style={selStyle}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
          >
            {quarters.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
            <option value="">{t.unspecifiedQuarter}</option>
          </select>
        </SelectWrap>

        {isEdit && (
          <>
            <label style={labelStyle} htmlFor="epic-status">
              {t.status}
            </label>
            <SelectWrap style={{ marginBottom: 20 }}>
              <select
                id="epic-status"
                style={selStyle}
                value={status}
                onChange={(e) => setStatus(e.target.value as Epic['status'])}
              >
                <option value="OPEN">{t.epicStatusOpen}</option>
                <option value="DONE">{t.epicStatusDone}</option>
              </select>
            </SelectWrap>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button type="button" onClick={onClose} style={btnGhost} className="hover-card">
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="btn-primary"
            style={{
              ...btnPrimary,
              height: 32,
              padding: '0 16px',
              borderRadius: 8,
              opacity: !name.trim() || isPending ? 0.6 : 1,
            }}
          >
            {isPending ? (isEdit ? t.saving : t.creating) : isEdit ? t.save : t.create}
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
  const epics = useEpics(slug, projectKey)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEpic, setEditingEpic] = useState<RoadmapEpic | null>(null)
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)
  const t = useT()

  if (projects.isLoading || (projectKey && roadmap.isLoading)) {
    return <RoadmapSkeleton />
  }
  if (projects.isError) {
    return <PageMessage error>{t.projectListLoadFailed(projects.error.message)}</PageMessage>
  }
  if (!projectKey) {
    return (
      <div style={pageStyle}>
        <h1 style={{ ...pageTitleStyle, marginBottom: 8 }}>{t.roadmap}</h1>
        <p style={{ fontSize: 13, color: 'var(--dim)', margin: 0 }}>
          {t.noProjectRoadmap}
        </p>
      </div>
    )
  }
  if (roadmap.isError) {
    return <PageMessage error>{t.roadmapLoadFailed(roadmap.error.message)}</PageMessage>
  }

  const groups = roadmap.data ?? []
  return (
    <div style={pageStyle}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={pageTitleStyle}>{t.roadmap}</h1>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="hover-card"
          style={{ ...btnSecondary, padding: '0 12px 0 9px' }}
        >
          <Icon name="plus" size={14} />
          {t.createEpic}
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
          {t.noEpicsYet}
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
                {group.quarter ?? t.unspecifiedQuarterGroup}
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
                    onEdit={() => setEditingEpic(epic)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {dialogOpen && (
        <EpicDialog slug={slug} projectKey={projectKey} onClose={() => setDialogOpen(false)} />
      )}
      {editingEpic && !epics.isLoading && (
        <EpicDialog
          key={editingEpic.id}
          slug={slug}
          projectKey={projectKey}
          // RoadmapEpic 无 description/quarter：用 useEpics 列表按 id 找全量数据回填，找不到时降级
          epic={
            epics.data?.find((e) => e.id === editingEpic.id) ?? {
              id: editingEpic.id,
              name: editingEpic.name,
              description: null,
              quarter: null,
              color: editingEpic.color,
              status: editingEpic.status,
            }
          }
          onClose={() => setEditingEpic(null)}
        />
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
