// 报表页：Sprint 燃尽图（remaining 实线 + ideal 虚线）+ 每人负载横条图
// 图表规范遵循 dataviz skill：2px 线、hairline 网格、文本用文字色、双系列必带图例。
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useBurndown, useCapacity, useProjects, useSprints } from '../api/hooks'
import type { CapacityEntry, Sprint, SprintStatus } from '../api/types'

// ---------- 视觉常量（dataviz reference palette，light） ----------

const C = {
  series1: '#2a78d6', // remaining 实线
  series1Track: '#cde2fb', // 容量条底轨（同 ramp 浅一档）
  critical: '#d03b3b', // 超配
  inkPrimary: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#fcfcfb',
  border: 'rgba(11,11,11,0.10)',
}

const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  PLANNED: '未开始',
  ACTIVE: '进行中',
  CLOSED: '已结束',
}

// ---------- 小组件 ----------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: C.inkPrimary }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: C.inkMuted }}>
      {text}
    </div>
  )
}

/** MM-DD 短日期刻度 */
function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5, 10) : d
}

// ---------- 燃尽图 ----------

function BurndownChart({ slug, sprintId }: { slug: string; sprintId: number }) {
  const { data, isLoading, isError } = useBurndown(slug, sprintId)

  if (isLoading) return <Empty text="加载燃尽数据中…" />
  if (isError) return <Empty text="燃尽数据加载失败" />
  if (!data || data.days.length === 0) return <Empty text="该 Sprint 暂无燃尽数据" />

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data.days} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fontSize: 12, fill: C.inkMuted }}
            stroke={C.axis}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: C.inkMuted }}
            stroke={C.axis}
            tickLine={false}
            axisLine={false}
            width={36}
            label={{
              value: 'points',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 11, fill: C.inkMuted },
            }}
          />
          <Tooltip
            labelFormatter={(label) => String(label)}
            formatter={(value, name) => [
              `${value} pts`,
              name === 'remaining' ? '剩余（remaining）' : '理想（ideal）',
            ]}
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.inkPrimary,
            }}
          />
          <Legend
            formatter={(value) => (
              <span style={{ fontSize: 12, color: C.inkSecondary }}>
                {value === 'remaining' ? '剩余 remaining' : '理想 ideal'}
              </span>
            )}
          />
          <Line
            name="ideal"
            dataKey="ideal"
            type="linear"
            stroke={C.inkMuted}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            name="remaining"
            dataKey="remaining"
            type="monotone"
            stroke={C.series1}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: C.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------- 每人负载横条图 ----------

function LoadRow({ entry, maxScale }: { entry: CapacityEntry; maxScale: number }) {
  const over = entry.capacity > 0 && entry.assignedPoints > entry.capacity
  const trackPct = maxScale > 0 ? (entry.capacity / maxScale) * 100 : 0
  const fillPct = maxScale > 0 ? (Math.min(entry.assignedPoints, entry.capacity) / maxScale) * 100 : 0
  const overPct =
    maxScale > 0 && over ? ((entry.assignedPoints - entry.capacity) / maxScale) * 100 : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span
        style={{
          width: 96,
          flexShrink: 0,
          fontSize: 13,
          color: C.inkSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={entry.displayName}
      >
        {entry.displayName}
      </span>
      <div style={{ flex: 1, position: 'relative', height: 16 }}>
        {/* 底轨 = 容量（同色系浅一档） */}
        <div
          style={{
            position: 'absolute',
            insetBlock: 0,
            left: 0,
            width: `${trackPct}%`,
            background: C.series1Track,
            borderRadius: '0 4px 4px 0',
          }}
        />
        {/* 已分配（封顶容量） */}
        <div
          style={{
            position: 'absolute',
            insetBlock: 0,
            left: 0,
            width: `${fillPct}%`,
            background: C.series1,
            borderRadius: over ? 0 : '0 4px 4px 0',
          }}
        />
        {/* 超配部分（critical 色，接在容量末端） */}
        {over && (
          <div
            style={{
              position: 'absolute',
              insetBlock: 0,
              left: `${trackPct}%`,
              width: `${overPct}%`,
              background: C.critical,
              borderRadius: '0 4px 4px 0',
            }}
          />
        )}
      </div>
      <span
        style={{
          width: 88,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          color: over ? C.critical : C.inkSecondary,
          fontWeight: over ? 600 : 400,
        }}
      >
        {entry.assignedPoints}/{entry.capacity} pts{over ? ' 超配' : ''}
      </span>
    </div>
  )
}

function CapacityLoad({ slug, sprintId }: { slug: string; sprintId: number }) {
  const { data, isLoading, isError } = useCapacity(slug, sprintId)

  if (isLoading) return <Empty text="加载负载数据中…" />
  if (isError) return <Empty text="负载数据加载失败" />
  if (!data || data.length === 0) return <Empty text="该 Sprint 暂无成员负载数据" />

  // 统一横向比例尺：以最大(容量, 已分配)为满刻度
  const maxScale = Math.max(...data.map((e) => Math.max(e.capacity, e.assignedPoints)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((entry) => (
        <LoadRow key={entry.userId} entry={entry} maxScale={maxScale} />
      ))}
      <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: C.inkMuted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 12, height: 8, background: C.series1, borderRadius: 2 }} />
          已分配
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 12, height: 8, background: C.series1Track, borderRadius: 2 }} />
          容量
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 12, height: 8, background: C.critical, borderRadius: 2 }} />
          超配
        </span>
      </div>
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
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, color: C.inkPrimary }}>报表</h1>
        <label style={{ fontSize: 13, color: C.inkSecondary, display: 'flex', gap: 8, alignItems: 'center' }}>
          Sprint
          <select
            value={effectiveId ?? ''}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            disabled={ordered.length === 0}
            style={{
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 6,
              border: `1px solid ${C.axis}`,
              background: C.surface,
              color: C.inkPrimary,
            }}
          >
            {ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{SPRINT_STATUS_LABEL[s.status]} {s.startDate} ~ {s.endDate}）
              </option>
            ))}
          </select>
        </label>
      </header>

      {projectsLoading || sprintsLoading ? (
        <Empty text="加载中…" />
      ) : !projectKey ? (
        <Empty text="当前租户还没有项目，先创建一个项目吧" />
      ) : ordered.length === 0 ? (
        <Empty text="该项目还没有 Sprint，去规划页创建一个吧" />
      ) : effectiveId == null ? (
        <Empty text="请选择一个 Sprint" />
      ) : (
        <>
          <Card title="燃尽图">
            <BurndownChart slug={slug} sprintId={effectiveId} />
          </Card>
          <Card title="每人负载">
            <CapacityLoad slug={slug} sprintId={effectiveId} />
          </Card>
        </>
      )}
    </div>
  )
}
