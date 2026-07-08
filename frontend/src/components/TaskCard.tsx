// 任务卡（全站复用原子）：看板卡片（variant="card"）与紧凑列表行（variant="row"）两种形态
// 视觉真源：docs/design/mock/markup.html 中 dc-import TaskCard 的两处 hint（100px 卡 / 38px 行）+ frontend-design-brief §3
import type { CSSProperties } from 'react'
import type { TaskBrief } from '../api/types'
import StatusBadge from './StatusBadge'
import TypeIcon from './TypeIcon'
import { Icon } from './icons'
import { fmtPoints } from '../utils/points'

/** 成员头像色板（与设计稿成员色一致），按名字哈希取色保证稳定 */
const AVATAR_COLORS = ['#6e79d6', '#3f9d6b', '#d6673f', '#c74d8a', '#4aa3c9']

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function Avatar({ name, size = 20 }: { name?: string | null; size?: number }) {
  const n = name?.trim()
  return (
    <span
      title={n ?? '未分配'}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: n ? avatarColor(n) : 'var(--card-2)',
        border: n ? 'none' : '1px dashed var(--border-strong)',
        color: n ? '#fff' : 'var(--faint)',
        fontSize: Math.round(size * 0.45),
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
      }}
    >
      {n ? n.charAt(0).toUpperCase() : '—'}
    </span>
  )
}

function PointsChip({ points }: { points: number | null }) {
  if (points == null) return null
  return (
    <span
      title={`${fmtPoints(points)} points`}
      style={{
        fontSize: 10.5,
        fontFamily: 'var(--font-mono)',
        color: 'var(--dim)',
        background: 'var(--card-2)',
        borderRadius: 20,
        padding: '1px 7px',
        lineHeight: '15px',
        flex: 'none',
      }}
    >
      {fmtPoints(points)}
    </span>
  )
}

export interface TaskCardProps {
  task: TaskBrief
  /** 项目 key，用于展示号 "PM-42"；缺省显示 "#42" */
  projectKey?: string
  /** 是否显示状态徽标（看板列内通常省略） */
  showStatus?: boolean
  onClick?: (task: TaskBrief) => void
  /** 形态：看板卡片（默认）或紧凑列表行 */
  variant?: 'card' | 'row'
  /** 负责人容量超载标记（看板卡角标） */
  flagged?: boolean
  /** 所属 Epic（有则在卡片形态展示色点 + 名称） */
  epic?: { name: string; color?: string | null } | null
  /** 「只看我的」视图下未指派任务的淡标记（避免被误认为自己的任务） */
  unassignedTag?: boolean
  style?: CSSProperties
}

/** 「未指派」淡文字标记（11px var(--faint)） */
function UnassignedTag() {
  return (
    <span style={{ fontSize: 11, color: 'var(--faint)', flex: 'none', whiteSpace: 'nowrap' }}>
      未指派
    </span>
  )
}

export default function TaskCard({
  task,
  projectKey,
  showStatus = true,
  onClick,
  variant = 'card',
  flagged = false,
  epic,
  unassignedTag = false,
  style,
}: TaskCardProps) {
  const showUnassigned = unassignedTag && task.assigneeId == null && task.assigneeName == null
  const displayId = projectKey ? `${projectKey}-${task.seq}` : `#${task.seq}`
  const clickable = !!onClick
  const handleClick = onClick ? () => onClick(task) : undefined

  const desc = task.description?.trim() || null

  if (variant === 'row') {
    // 紧凑列表行：类型图标 · 编号 · 标题(+描述摘要第二行) · [状态] · points · 头像
    return (
      <div
        onClick={handleClick}
        role={clickable ? 'button' : undefined}
        className="task-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 38,
          padding: desc ? '6px 9px' : '0 9px',
          borderRadius: 7,
          cursor: clickable ? 'pointer' : 'default',
          minWidth: 0,
          transition: 'background .1s',
          ...style,
        }}
      >
        <TypeIcon type={task.type} size={14} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--faint)',
            flex: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {displayId}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {task.title}
          </span>
          {desc && (
            <span
              title={desc}
              style={{
                display: 'block',
                fontSize: 11.5,
                color: 'var(--dim)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: 2,
              }}
            >
              {desc}
            </span>
          )}
        </span>
        {flagged && (
          <span title="负责人容量超载" style={{ display: 'flex', color: 'var(--over)', flex: 'none' }}>
            <Icon name="alert" size={12} />
          </span>
        )}
        {showStatus && <StatusBadge status={task.status} />}
        <PointsChip points={task.points} />
        {showUnassigned && <UnassignedTag />}
        <Avatar name={task.assigneeName} size={20} />
        {task.assigneeName && (
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--dim)',
              maxWidth: 84,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {task.assigneeName}
          </span>
        )}
      </div>
    )
  }

  // 看板卡片（~100px）：首行 编号+points，中间标题，底行 类型/Epic + 头像
  return (
    <div
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      className="task-card"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 9,
        boxShadow: 'var(--shadow-xs)',
        padding: '10px 11px 9px',
        cursor: clickable ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        transition: 'background .1s, border-color .1s',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <TypeIcon type={task.type} size={14} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>
          {displayId}
        </span>
        {flagged && (
          <span title="负责人容量超载" style={{ display: 'flex', color: 'var(--over)' }}>
            <Icon name="alert" size={12} />
          </span>
        )}
        <span style={{ flex: 1 }} />
        {showStatus && <StatusBadge status={task.status} />}
        <PointsChip points={task.points} />
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.4,
          color: 'var(--text)',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {task.title}
      </div>
      {desc && (
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.45,
            color: 'var(--dim)',
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginTop: -2,
          }}
        >
          {desc}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 20 }}>
        {epic && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: 'var(--dim)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                background: epic.color ?? 'var(--faint)',
                flex: 'none',
              }}
            />
            {epic.name}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {showUnassigned && <UnassignedTag />}
        <Avatar name={task.assigneeName} size={20} />
        {task.assigneeName && (
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--dim)',
              maxWidth: 88,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {task.assigneeName}
          </span>
        )}
      </div>
    </div>
  )
}
