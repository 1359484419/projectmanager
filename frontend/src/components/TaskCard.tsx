import type { TaskBrief } from '../api/types'
import StatusBadge from './StatusBadge'
import TypeIcon from './TypeIcon'

export interface TaskCardProps {
  task: TaskBrief
  /** 项目 key，用于展示号 "PM-42"；缺省显示 "#42" */
  projectKey?: string
  /** 是否显示状态徽标（看板列内通常省略） */
  showStatus?: boolean
  onClick?: (task: TaskBrief) => void
}

export default function TaskCard({ task, projectKey, showStatus = true, onClick }: TaskCardProps) {
  const displayId = projectKey ? `${projectKey}-${task.seq}` : `#${task.seq}`
  const initial = task.assigneeName?.trim().charAt(0).toUpperCase()
  return (
    <div
      onClick={onClick ? () => onClick(task) : undefined}
      role={onClick ? 'button' : undefined}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '8px 12px',
        background: '#fff',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 14, lineHeight: '20px', wordBreak: 'break-word' }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TypeIcon type={task.type} />
        <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{displayId}</span>
        {showStatus && <StatusBadge status={task.status} />}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {task.points != null && (
            <span
              title={`${task.points} points`}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#374151',
                background: '#f3f4f6',
                borderRadius: 9999,
                padding: '1px 8px',
              }}
            >
              {task.points}
            </span>
          )}
          {initial && (
            <span
              title={task.assigneeName ?? undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: '50%',
                fontSize: 11,
                fontWeight: 700,
                color: '#fff',
                background: '#6366f1',
              }}
            >
              {initial}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
