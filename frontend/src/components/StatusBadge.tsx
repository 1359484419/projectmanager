import type { TaskStatus } from '../api/types'

const STATUS_META: Record<TaskStatus, { label: string; bg: string; fg: string }> = {
  TODO: { label: 'To Do', bg: '#e5e7eb', fg: '#374151' },
  IN_PROGRESS: { label: 'In Progress', bg: '#dbeafe', fg: '#1d4ed8' },
  COMPLETED: { label: 'Completed', bg: '#fef3c7', fg: '#b45309' },
  DONE: { label: 'Done', bg: '#dcfce7', fg: '#15803d' },
}

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        background: meta.bg,
        color: meta.fg,
      }}
    >
      {meta.label}
    </span>
  )
}
