// 状态徽标：四态语义色（soft 底 + 主色文字），文案与设计稿一致
import type { TaskStatus } from '../api/types'

const META: Record<TaskStatus, { label: string; v: string }> = {
  TODO: { label: '待办', v: 'todo' },
  IN_PROGRESS: { label: '进行中', v: 'prog' },
  COMPLETED: { label: '待验收', v: 'comp' },
  DONE: { label: '已完成', v: 'done' },
}

export default function StatusBadge({ status, dot = false }: { status: TaskStatus; dot?: boolean }) {
  const meta = META[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 9px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        background: `var(--${meta.v}-soft)`,
        color: `var(--${meta.v})`,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: `var(--${meta.v})`,
            flex: 'none',
          }}
        />
      )}
      {meta.label}
    </span>
  )
}
