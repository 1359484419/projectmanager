// 状态徽标：四态语义色（soft 底 + 主色文字），文案与设计稿一致
import type { TaskStatus } from '../api/types'
import { useT } from '../i18n'

const VAR_MAP: Record<TaskStatus, string> = {
  TODO: 'todo',
  IN_PROGRESS: 'prog',
  COMPLETED: 'comp',
  DONE: 'done',
}

const LABEL_KEY: Record<TaskStatus, 'statusTodo' | 'statusInProgress' | 'statusCompleted' | 'statusDone'> = {
  TODO: 'statusTodo',
  IN_PROGRESS: 'statusInProgress',
  COMPLETED: 'statusCompleted',
  DONE: 'statusDone',
}

export default function StatusBadge({ status, dot = false }: { status: TaskStatus; dot?: boolean }) {
  const t = useT()
  const v = VAR_MAP[status]
  const label = t[LABEL_KEY[status]]
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
        background: `var(--${v}-soft)`,
        color: `var(--${v})`,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: `var(--${v})`,
            flex: 'none',
          }}
        />
      )}
      {label}
    </span>
  )
}
