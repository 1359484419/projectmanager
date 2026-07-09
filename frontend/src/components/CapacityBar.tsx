// 成员容量条（PLANNING 节 capacityRows 行）：头像 + 名字 + 进度条 + assigned / capacity 行内编辑
// 视觉真源：docs/design/mock/markup.html PLANNING 节 + logic.jsx memberLoad()（超载斜纹算法照搬）
import { useEffect, useState } from 'react'
import { Avatar } from './TaskCard'
import { fmtPoints } from '../utils/points'
import { useT } from '../i18n'

export interface CapacityBarProps {
  /** 成员显示名 */
  name: string
  /** 已分配 points */
  assigned: number
  /** 容量（工作日数，可被 override） */
  capacity: number
  /** 容量数字行内编辑提交（Enter / blur）后回调；缺省则数字只读 */
  onCapacityChange?: (capacity: number) => void
}

/** 超载段斜纹（logic.jsx memberLoad 原样搬运） */
const OVER_STRIPES =
  'repeating-linear-gradient(45deg,var(--over),var(--over) 4px,transparent 4px,transparent 7px)'

/**
 * 成员容量条：`assigned / capacity`。
 * - 占用 ≤100%：var(--prog) 实心条按百分比填充；
 * - 超载：实心段收窄为 cap/assigned，右侧 (assigned-cap)/assigned 画红斜纹（与设计稿算法一致）；
 * - 右侧容量数字为常驻 number 输入框，Enter / 失焦提交 override。
 */
export default function CapacityBar({ name, assigned, capacity, onCapacityChange }: CapacityBarProps) {
  const t = useT()
  const [draft, setDraft] = useState(String(capacity))

  useEffect(() => {
    setDraft(String(capacity))
  }, [capacity])

  const over = assigned > capacity
  // 非超载：条宽 = 占用百分比（封顶 100）；capacity=0 且无占用时为 0
  const pct = capacity > 0 ? Math.min((assigned / capacity) * 100, 100) : 0
  // 超载：实心段 = cap/assigned，斜纹段 = (assigned-cap)/assigned（同 logic.jsx）
  const fillW = over && assigned > 0 ? (capacity / assigned) * 100 : pct
  const overW = over && assigned > 0 ? ((assigned - capacity) / assigned) * 100 : 0

  function commit() {
    const value = Number(draft)
    if (!Number.isInteger(value) || value < 0 || value === capacity) {
      setDraft(String(capacity))
      return
    }
    onCapacityChange?.(value)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <Avatar name={name} size={24} />
      <span
        title={name}
        style={{
          width: 52,
          flex: 'none',
          fontSize: 12.5,
          color: 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <div
        style={{
          flex: 1,
          height: 9,
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
            width: `${fillW}%`,
            background: 'var(--prog)',
            transition: 'width .2s ease',
          }}
        />
        {over && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: `${overW}%`,
              background: OVER_STRIPES,
              borderLeft: '1px solid var(--bg)',
            }}
          />
        )}
      </div>
      <span
        style={{
          fontSize: 11.5,
          fontFamily: 'var(--font-mono)',
          color: over ? 'var(--over)' : 'var(--dim)',
          width: 30,
          textAlign: 'right',
          flex: 'none',
        }}
      >
        {fmtPoints(assigned)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--faint)' }}>/</span>
      {onCapacityChange ? (
        <input
          type="number"
          min={0}
          value={draft}
          title={t.editCapacity}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(String(capacity))
          }}
          style={{
            width: 38,
            height: 22,
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'var(--card-2)',
            color: 'var(--dim)',
            fontSize: 11.5,
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            flex: 'none',
            outline: 'none',
          }}
        />
      ) : (
        <span
          style={{
            width: 38,
            fontSize: 11.5,
            fontFamily: 'var(--font-mono)',
            color: 'var(--dim)',
            textAlign: 'center',
            flex: 'none',
          }}
        >
          {capacity}
        </span>
      )}
    </div>
  )
}
