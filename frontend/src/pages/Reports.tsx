// 报表页：Sprint 燃尽图（自绘 SVG：ideal 虚线 + remaining 主色线/渐隐面积/圆点）+ 每人负载横条
// 视觉真源：docs/design/mock/markup.html（REPORTS 节）+ logic.jsx burndown()/memberLoad()
import { useMemo, useState, type CSSProperties } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useBurndown, useCapacity, useProjects, useSprints } from '../api/hooks'
import type { BurndownDay, CapacityEntry, Sprint, SprintStatus } from '../api/types'
import { SelectWrap, cardStyle, pageTitleStyle } from '../components/ui'
import { fmtPoints } from '../utils/points'

const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  PLANNED: '未开始',
  ACTIVE: '进行中',
  CLOSED: '已结束',
}

const MONO = "'JetBrains Mono',monospace"

// ---------- 通用小块 ----------

const cardPad: CSSProperties = { ...cardStyle, padding: '16px 18px' }

const cardTitleStyle: CSSProperties = { fontSize: 12.5, fontWeight: 600 }

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--faint)' }}>
      {text}
    </div>
  )
}

/** 燃尽图卡片 loading 骨架 */
function ChartSkeleton() {
  return <div className="sk" style={{ width: '100%', height: 220 }} />
}

/** 负载列表 loading 骨架 */
function LoadSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sk" style={{ width: 46, height: 12, flex: 'none' }} />
          <span className="sk" style={{ flex: 1, height: 16, borderRadius: 5 }} />
          <span className="sk" style={{ width: 46, height: 12, flex: 'none' }} />
        </div>
      ))}
    </div>
  )
}

/** YYYY-MM-DD → MM-DD */
function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5, 10) : d
}

// ---------- 燃尽图（自绘 SVG，风格同 logic.jsx burndown()） ----------

function BurndownSvg({ days }: { days: BurndownDay[] }) {
  const W = 620
  const H = 248
  const pl = 40
  const pr = 16
  const pt = 14
  const pb = 28
  const pw = W - pl - pr
  const ph = H - pt - pb

  const n = days.length
  const maxV = Math.max(...days.map((d) => Math.max(d.remaining, d.ideal)), 1)
  const x = (i: number) => pl + (n > 1 ? i * (pw / (n - 1)) : pw / 2)
  const y = (v: number) => pt + (1 - v / maxV) * ph

  // 横向网格 + Y 轴刻度（5 档）
  const gridLines = [0, 1, 2, 3, 4].map((k) => {
    const yy = pt + (k / 4) * ph
    return { yy, label: Math.round(maxV * (1 - k / 4)) }
  })

  // X 轴日期刻度（约 8 个，含首尾）
  const step = Math.max(1, Math.ceil(n / 8))
  const xTicks: number[] = []
  for (let i = 0; i < n; i += step) xTicks.push(i)
  if (n > 1 && xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1)

  const idealPts = days.map((d, i) => `${x(i)},${y(d.ideal)}`).join(' ')
  const remPts = days.map((d, i) => `${x(i)},${y(d.remaining)}`)
  const area = `${x(0)},${pt + ph} ${remPts.join(' ')} ${x(n - 1)},${pt + ph}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Sprint 燃尽图">
      {gridLines.map((g, k) => (
        <g key={k}>
          <line x1={pl} y1={g.yy} x2={W - pr} y2={g.yy} stroke="var(--grid)" />
          <text x={pl - 7} y={g.yy + 3} textAnchor="end" fontSize={9} fill="var(--faint)" fontFamily={MONO}>
            {g.label}
          </text>
        </g>
      ))}
      {xTicks.map((i) => (
        <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize={9} fill="var(--faint)" fontFamily={MONO}>
          {shortDate(days[i].date)}
        </text>
      ))}
      <polyline points={idealPts} fill="none" stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="4 4" />
      <polygon points={area} fill="var(--accent)" fillOpacity={0.09} />
      <polyline points={remPts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      {remPts.map((p, i) => {
        const [cx, cy] = p.split(',')
        return <circle key={i} cx={cx} cy={cy} r={3} fill="var(--accent)" />
      })}
    </svg>
  )
}

function BurndownCard({ slug, sprintId }: { slug: string; sprintId: number }) {
  const { data, isLoading, isError } = useBurndown(slug, sprintId)

  return (
    <div style={cardPad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
        <span style={cardTitleStyle}>燃尽图</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--dim)' }}>
          <span style={{ width: 16, height: 2, background: 'var(--accent)', borderRadius: 2 }} />
          剩余
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--dim)' }}>
          <span style={{ width: 16, height: 0, borderTop: '2px dashed var(--faint)' }} />
          理想
        </span>
      </div>
      {isLoading ? (
        <ChartSkeleton />
      ) : isError ? (
        <Empty text="燃尽数据加载失败" />
      ) : !data || data.days.length === 0 ? (
        <Empty text="该 Sprint 暂无燃尽数据" />
      ) : (
        <BurndownSvg days={data.days} />
      )}
    </div>
  )
}

// ---------- 每人负载横条（同容量条风格：var(--prog) 填充 + 超载斜纹） ----------

function LoadRow({ entry }: { entry: CapacityEntry }) {
  const { displayName, assignedPoints: assigned, capacity: cap } = entry
  const over = assigned > cap
  // ≤容量：按占比填充；超载：主色填到容量占比处，其余画 var(--over) 斜纹（logic.jsx memberLoad 算法）
  const fillPct = over
    ? assigned > 0
      ? (cap / assigned) * 100
      : 0
    : cap > 0
      ? Math.min(100, (assigned / cap) * 100)
      : 0
  const overPct = over && assigned > 0 ? ((assigned - cap) / assigned) * 100 : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        title={displayName}
        style={{
          width: 46,
          flex: 'none',
          fontSize: 12,
          color: 'var(--dim)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </span>
      <div
        style={{
          flex: 1,
          height: 16,
          borderRadius: 5,
          background: 'var(--card-2)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${fillPct}%`,
            background: 'var(--prog)',
          }}
        />
        {over && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: `${overPct}%`,
              background:
                'repeating-linear-gradient(45deg,var(--over),var(--over) 4px,transparent 4px,transparent 7px)',
              borderLeft: '1px solid var(--bg)',
            }}
          />
        )}
      </div>
      <span
        style={{
          fontSize: 11.5,
          fontFamily: MONO,
          color: over ? 'var(--over)' : 'var(--dim)',
          width: 46,
          textAlign: 'right',
          flex: 'none',
        }}
      >
        {fmtPoints(assigned)}/{fmtPoints(cap)}
      </span>
    </div>
  )
}

function CapacityCard({ slug, sprintId }: { slug: string; sprintId: number }) {
  const { data, isLoading, isError } = useCapacity(slug, sprintId)

  return (
    <div style={cardPad}>
      <div style={{ ...cardTitleStyle, marginBottom: 16 }}>每人负载</div>
      {isLoading ? (
        <LoadSkeleton />
      ) : isError ? (
        <Empty text="负载数据加载失败" />
      ) : !data || data.length === 0 ? (
        <Empty text="该 Sprint 暂无成员负载数据" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.map((entry) => (
            <LoadRow key={entry.userId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- 页面 ----------

export default function Reports() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()

  const { data: projects, isLoading: projectsLoading } = useProjects(slug)
  const projectKey = searchParams.get('project') ?? projects?.[0]?.key ?? ''

  const { data: sprints, isLoading: sprintsLoading } = useSprints(slug, projectKey)

  // 下拉候选：倒序（新的在前），含 CLOSED；默认选 ACTIVE，否则最新一个
  const ordered: Sprint[] = useMemo(() => {
    if (!sprints) return []
    return [...sprints].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
  }, [sprints])

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const effectiveId =
    selectedId ?? ordered.find((s) => s.status === 'ACTIVE')?.id ?? ordered[0]?.id ?? null

  if (!slug) return <Empty text="缺少租户信息" />

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={pageTitleStyle}>报表</h1>
        <SelectWrap chevronTop={9}>
          <select
            value={effectiveId ?? ''}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            disabled={ordered.length === 0}
            style={{
              height: 30,
              borderRadius: 7,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
              fontSize: 12.5,
              padding: '0 28px 0 11px',
              cursor: 'pointer',
            }}
          >
            {ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{SPRINT_STATUS_LABEL[s.status]} {s.startDate} ~ {s.endDate}）
              </option>
            ))}
          </select>
        </SelectWrap>
      </div>

      {projectsLoading || sprintsLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
          <div style={cardPad}>
            <ChartSkeleton />
          </div>
          <div style={cardPad}>
            <LoadSkeleton />
          </div>
        </div>
      ) : !projectKey ? (
        <Empty text="当前租户还没有项目，先创建一个项目吧" />
      ) : ordered.length === 0 ? (
        <Empty text="该项目还没有 Sprint，去规划页创建一个吧" />
      ) : effectiveId == null ? (
        <Empty text="请选择一个 Sprint" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
          <BurndownCard slug={slug} sprintId={effectiveId} />
          <CapacityCard slug={slug} sprintId={effectiveId} />
        </div>
      )}
    </div>
  )
}
