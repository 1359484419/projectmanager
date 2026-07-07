// Dashboard：当前 ACTIVE Sprint 四状态概览（只读）。
// 数据：GET /api/t/{slug}/projects/{key}/dashboard（useDashboard）。
// 项目选择：?project=KEY 查询参数，缺省取项目列表第一个。
// 注：任务卡点击开 TaskDrawer 由 Task 23 统一接入（届时给 TaskCard 传 onClick）。
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useDashboard, useProjects } from '../api/hooks'
import type { Dashboard as DashboardData, TaskStatus } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import TaskCard from '../components/TaskCard'

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'DONE']

/** donePct 进度环（0-100） */
function ProgressRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const size = 64
  const stroke = 7
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  return (
    <svg width={size} height={size} role="img" aria-label={`完成度 ${clamped}%`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#15803d"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        style={{ fontSize: 13, fontWeight: 700, fill: '#374151' }}
      >
        {clamped}%
      </text>
    </svg>
  )
}

/** 顶部统计条：Sprint 信息 + 四状态计数 + 剩余天数 + 完成度环 */
function StatsBar({ data }: { data: DashboardData }) {
  const sprint = data.sprint
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 24,
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        background: '#fff',
        padding: '16px 20px',
        marginBottom: 24,
      }}
    >
      <div style={{ minWidth: 160 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{sprint?.name}</div>
        {sprint && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            截止 {sprint.endDate} · 剩余 <strong>{sprint.daysLeft}</strong> 天
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>
              {data.counts[s] ?? 0}
            </span>
            <StatusBadge status={s} />
          </div>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <ProgressRing pct={data.donePct} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>整体完成度</span>
      </div>
    </div>
  )
}

/** 四状态分组列表（只读） */
function StatusGroups({ data, projectKey }: { data: DashboardData; projectKey: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <StatusBadge status={s} />
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{tasks.length}</span>
            </header>
            {tasks.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 4px' }}>暂无任务</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} projectKey={projectKey} showStatus={false} />
                ))}
              </div>
            )}
          </section>
        )
      })}
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

  if (projects.isLoading || (projectKey && dashboard.isLoading)) {
    return <p style={{ padding: 24, color: '#6b7280' }}>加载中…</p>
  }
  if (projects.isError) {
    return <p style={{ padding: 24, color: '#b91c1c' }}>项目列表加载失败：{projects.error.message}</p>
  }
  if (!projectKey) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Dashboard</h1>
        <p style={{ color: '#6b7280' }}>当前租户还没有项目，请先创建项目。</p>
      </div>
    )
  }
  if (dashboard.isError) {
    return <p style={{ padding: 24, color: '#b91c1c' }}>概览加载失败：{dashboard.error.message}</p>
  }

  const data = dashboard.data
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
        Dashboard · {projectKey}
      </h1>
      {!data || data.sprint == null ? (
        <div
          style={{
            border: '1px dashed #d1d5db',
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
            color: '#6b7280',
          }}
        >
          <p style={{ marginBottom: 12 }}>当前没有进行中的 Sprint。</p>
          <Link
            to={`/t/${slug}/planning`}
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              borderRadius: 8,
              background: '#4f46e5',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            去创建 Sprint
          </Link>
        </div>
      ) : (
        <>
          <StatsBar data={data} />
          <StatusGroups data={data} projectKey={projectKey} />
        </>
      )}
    </div>
  )
}
