// EpicCard：路线图 Epic 卡片。
// 左侧颜色条 + 名称/状态 + donePoints/totalPoints 进度条；点击展开其下任务列表（TaskBrief）。
import { useState } from 'react'
import type { RoadmapEpic } from '../api/types'
import TaskCard from './TaskCard'

const DEFAULT_COLOR = '#6366f1'

export interface EpicCardProps {
  epic: RoadmapEpic
  /** 项目 key，透传给展开的 TaskCard 展示 "PM-42" 号 */
  projectKey?: string
}

export default function EpicCard({ epic, projectKey }: EpicCardProps) {
  const [expanded, setExpanded] = useState(false)
  const color = epic.color || DEFAULT_COLOR
  const pct =
    epic.totalPoints > 0
      ? Math.max(0, Math.min(100, Math.round((epic.donePoints / epic.totalPoints) * 100)))
      : 0

  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* 颜色条 */}
      <div style={{ width: 6, flexShrink: 0, background: color }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0, padding: '12px 16px' }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 11,
              color: '#6b7280',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          >
            ▶
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#111827',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {epic.name}
          </span>
          {epic.status === 'DONE' && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#15803d',
                background: '#dcfce7',
                borderRadius: 9999,
                padding: '2px 8px',
                flexShrink: 0,
              }}
            >
              Done
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
            {epic.donePoints} / {epic.totalPoints} pts · {pct}%
          </span>
        </button>

        {/* 进度条 */}
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            marginTop: 10,
            height: 8,
            borderRadius: 9999,
            background: '#f3f4f6',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 9999,
              background: color,
              transition: 'width 0.2s',
            }}
          />
        </div>

        {/* 展开的任务列表 */}
        {expanded && (
          <div style={{ marginTop: 12 }}>
            {epic.tasks.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9ca3af', padding: '4px 0' }}>
                该 Epic 下暂无任务
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {epic.tasks.map((task) => (
                  <TaskCard key={task.id} task={task} projectKey={projectKey} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
