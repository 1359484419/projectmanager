import type { TaskType } from '../api/types'

const TYPE_META: Record<TaskType, { label: string; symbol: string; bg: string }> = {
  STORY: { label: 'Story', symbol: 'S', bg: '#22c55e' },
  BUG: { label: 'Bug', symbol: 'B', bg: '#ef4444' },
  TASK: { label: 'Task', symbol: 'T', bg: '#3b82f6' },
}

export default function TypeIcon({ type, size = 16 }: { type: TaskType; size?: number }) {
  const meta = TYPE_META[type]
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 3,
        fontSize: size * 0.65,
        fontWeight: 700,
        color: '#fff',
        background: meta.bg,
        flexShrink: 0,
      }}
    >
      {meta.symbol}
    </span>
  )
}
