import { useEffect, useState } from 'react'

export interface CapacityBarProps {
  /** 成员显示名 */
  name: string
  /** 已分配 points */
  assigned: number
  /** 容量（工作日数，可被 override） */
  capacity: number
  /** 点容量数字修改 override 后回调；缺省则数字不可编辑 */
  onCapacityChange?: (capacity: number) => void
}

const GREEN = '#22c55e'
const RED = '#ef4444'
const TRACK = '#e5e7eb'

/** 超出容量部分的斜纹背景 */
const STRIPES =
  'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 4px, transparent 4px, transparent 8px)'

/**
 * 成员容量条：`assigned/capacity`。
 * - 占用 ≤100% 绿色，>100% 红色；
 * - 条宽按百分比封顶 100%，超出容量的部分以斜纹标示；
 * - 点击容量数字可行内编辑（提交 override）。
 */
export default function CapacityBar({ name, assigned, capacity, onCapacityChange }: CapacityBarProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(capacity))

  useEffect(() => {
    setDraft(String(capacity))
  }, [capacity])

  const over = assigned > capacity
  const pct = capacity > 0 ? Math.min((assigned / capacity) * 100, 100) : assigned > 0 ? 100 : 0
  // 超载时：条被填满，右侧 (assigned-capacity)/assigned 比例的部分画斜纹
  const stripePct = over && assigned > 0 ? ((assigned - capacity) / assigned) * 100 : 0

  function commit() {
    setEditing(false)
    const value = Number(draft)
    if (!Number.isInteger(value) || value < 0 || value === capacity) {
      setDraft(String(capacity))
      return
    }
    onCapacityChange?.(value)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        title={name}
        style={{
          width: 72,
          flexShrink: 0,
          fontSize: 13,
          color: '#374151',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: 14,
          background: TRACK,
          borderRadius: 7,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: over ? RED : GREEN,
            borderRadius: 7,
            transition: 'width 0.2s ease',
          }}
        />
        {over && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: `${stripePct}%`,
              background: STRIPES,
            }}
          />
        )}
      </div>
      <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, color: over ? RED : '#111827' }}>{assigned}</span>
        <span style={{ color: '#9ca3af' }}> / </span>
        {editing ? (
          <input
            autoFocus
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(String(capacity))
                setEditing(false)
              }
            }}
            style={{ width: 48, fontSize: 13, padding: '0 4px' }}
          />
        ) : (
          <span
            onClick={onCapacityChange ? () => setEditing(true) : undefined}
            role={onCapacityChange ? 'button' : undefined}
            title={onCapacityChange ? '点击修改容量 override' : undefined}
            style={{
              color: '#6b7280',
              cursor: onCapacityChange ? 'pointer' : 'default',
              textDecoration: onCapacityChange ? 'underline dotted' : 'none',
            }}
          >
            {capacity}
          </span>
        )}
      </span>
    </div>
  )
}
