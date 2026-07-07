// Dashboard：当前 ACTIVE Sprint 四状态概览（只读）。
// 数据：GET /api/t/{slug}/projects/{key}/dashboard（useDashboard）。
// 项目选择：?project=KEY 查询参数，缺省取项目列表第一个。
// 点任务卡打开 TaskDrawer 查看/编辑详情。
// 视觉真源：docs/design/mock/markup.html DASHBOARD 节 + logic.jsx donutSvg。
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useDashboard, useProjects } from '../api/hooks'
import type { Dashboard as DashboardData, TaskBrief, TaskStatus } from '../api/types'
import TaskCard from '../components/TaskCard'
import TaskDrawer from '../components/TaskDrawer'
import { Icon } from '../components/icons'
import { STATUS_LABEL, btnPrimary, pageTitleStyle, statusColor } from '../components/ui'

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'DONE']

/** 状态色点（8px 圆） */
function Dot({ status }: { status: TaskStatus }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: statusColor(status),
        flex: 'none',
      }}
    />
  )
}

/** 完成度 donut（74px，R=30，stroke 7，算法同 logic.jsx donutSvg） */
function Donut({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const R = 30
  const C = 2 * Math.PI * R
  const off = C * (1 - clamped / 100)
  return (
    <div style={{ position: 'relative', width: 74, height: 74, flex: 'none' }}>
      <svg
        viewBox="0 0 74 74"
        width={74}
        height={74}
        style={{ display: 'block' }}
        role="img"
        aria-label={`完成度 ${clamped}%`}
      >
        <circle cx="37" cy="37" r={R} fill="none" stroke="var(--card-2)" strokeWidth={7} />
        <circle
          cx="37"
          cy="37"
          r={R}
          fill="none"
          stroke="var(--done)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={off}
          transform="rotate(-90 37 37)"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        <b style={{ fontSize: 18 }}>{clamped}%</b>
        <span style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>完成</span>
      </div>
    </div>
  )
}

/** 统计卡行：完成度 donut + Sprint 信息卡 + 四状态计数卡 */
function StatsRow({ data }: { data: DashboardData }) {
  const sprint = data.sprint
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
      <div
        style={{
          flex: 1,
          minWidth: 230,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <Donut pct={data.donePct} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>当前 Sprint</span>
          <span style={{ fontSize: 16, fontWeight: 650 }}>{sprint?.name}</span>
          {sprint && (
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>
              剩余{' '}
              <b style={{ color: 'var(--comp)', fontFamily: 'var(--font-mono)' }}>
                {sprint.daysLeft}
              </b>{' '}
              天 · 截止 {sprint.endDate}
            </span>
          )}
        </div>
      </div>
      {STATUSES.map((s) => (
        <div
          key={s}
          style={{
            width: 150,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Dot status={s} />
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>{STATUS_LABEL[s]}</span>
          </div>
          <span
            style={{
              fontSize: 26,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              lineHeight: 1,
            }}
          >
            {data.counts[s] ?? 0}
          </span>
        </div>
      ))}
    </div>
  )
}

/** 四状态分组列表（点行开抽屉） */
function StatusGroups({
  data,
  projectKey,
  onOpen,
}: {
  data: DashboardData
  projectKey: string
  onOpen: (task: TaskBrief) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16,
        alignItems: 'start',
      }}
    >
      {STATUSES.map((s) => {
        const tasks = data.groups[s] ?? []
        return (
          <section
            key={s}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 14px',
                borderBottom: '1px solid var(--border-soft)',
              }}
            >
              <Dot status={s} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{STATUS_LABEL[s]}</span>
              <span
                style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}
              >
                {tasks.length}
              </span>
            </header>
            <div style={{ padding: 5 }}>
              {tasks.length === 0 ? (
                <div
                  style={{
                    padding: 14,
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'var(--faint)',
                  }}
                >
                  暂无
                </div>
              ) : (
                tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    projectKey={projectKey}
                    variant="row"
                    showStatus={false}
                    onClick={onOpen}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** loading 骨架：统计卡行 + 两块分组占位（.sk 见 styles.css） */
function DashboardSkeleton() {
  return (
    <>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <div className="sk" style={{ flex: 1, minWidth: 230, height: 106, borderRadius: 12 }} />
        {STATUSES.map((s) => (
          <div key={s} className="sk" style={{ width: 150, height: 106, borderRadius: 12 }} />
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        <div className="sk" style={{ height: 180, borderRadius: 12 }} />
        <div className="sk" style={{ height: 180, borderRadius: 12 }} />
      </div>
    </>
  )
}

/** 页面容器 + 标题行（含刷新按钮） */
function Page({ onRefresh, children }: { onRefresh?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={pageTitleStyle}>Dashboard</h1>
        <span style={{ flex: 1 }} />
        {onRefresh && (
          <Icon
            name="refresh"
            size={15}
            title="刷新"
            onClick={onRefresh}
            style={{ color: 'var(--dim)', cursor: 'pointer' }}
          />
        )}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const projects = useProjects(slug)
  // ?project=KEY 指定项目，缺省用第一个项目
  const projectKey = searchParams.get('project') ?? projects.data?.[0]?.key ?? ''
  const dashboard = useDashboard(slug, projectKey)
  const [drawerTask, setDrawerTask] = useState<TaskBrief | null>(null)

  if (projects.isLoading || (projectKey && dashboard.isLoading)) {
    return (
      <Page>
        <DashboardSkeleton />
      </Page>
    )
  }
  if (projects.isError) {
    return (
      <Page>
        <p style={{ fontSize: 13, color: 'var(--over)' }}>
          项目列表加载失败：{projects.error.message}
        </p>
      </Page>
    )
  }
  if (!projectKey) {
    return (
      <Page>
        <div
          style={{
            border: '1px dashed var(--border-strong)',
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--dim)',
          }}
        >
          当前租户还没有项目，请先创建项目。
        </div>
      </Page>
    )
  }
  if (dashboard.isError) {
    return (
      <Page>
        <p style={{ fontSize: 13, color: 'var(--over)' }}>
          概览加载失败：{dashboard.error.message}
        </p>
      </Page>
    )
  }

  const data = dashboard.data
  return (
    <Page onRefresh={() => void dashboard.refetch()}>
      {!data || data.sprint == null ? (
        <div
          style={{
            border: '1px dashed var(--border-strong)',
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--dim)',
          }}
        >
          <p style={{ fontSize: 13, marginBottom: 14 }}>当前没有进行中的 Sprint。</p>
          <Link to={`/t/${slug}/planning`} style={{ ...btnPrimary, textDecoration: 'none' }}>
            去创建 Sprint
          </Link>
        </div>
      ) : (
        <>
          <StatsRow data={data} />
          <StatusGroups data={data} projectKey={projectKey} onOpen={setDrawerTask} />
        </>
      )}
      {drawerTask && (
        <TaskDrawer
          slug={slug}
          projectKey={projectKey}
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
        />
      )}
    </Page>
  )
}
