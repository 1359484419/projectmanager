// 紧凑版负责人筛选（Backlog / Dashboard 标题行用）：「只看我的 | 全部」胶囊切换 + 按人下拉。
// 与看板筛选行共用 useAssigneeFilter（localStorage pm-assignee-filter），三页联动。
import { currentUserId } from '../api/client'
import { useMembers } from '../api/hooks'
import { useAssigneeFilter } from '../state/assigneeFilter'
import { SelectWrap } from './ui'

const MODES = [
  { value: 'me', label: '只看我的' },
  { value: 'all', label: '全部' },
] as const

export default function AssigneeFilterCompact({ slug }: { slug: string }) {
  const members = useMembers(slug)
  const [filter, setFilter] = useAssigneeFilter()
  const me = currentUserId()

  const byUser = typeof filter === 'number'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 3,
        }}
      >
        {MODES.map((m) => {
          const on = filter === m.value
          return (
            <span
              key={m.value}
              role="button"
              aria-pressed={on}
              onClick={() => setFilter(m.value)}
              style={{
                padding: '4px 11px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
                transition: '.1s',
                whiteSpace: 'nowrap',
                ...(on
                  ? { background: 'var(--accent)', color: '#fff', fontWeight: 600 }
                  : { color: 'var(--dim)' }),
              }}
            >
              {m.label}
            </span>
          )
        })}
      </div>
      {(members.data ?? []).length > 0 && (
        <SelectWrap chevronTop={8} style={{ flex: 'none' }}>
          <select
            value={byUser ? String(filter) : ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) setFilter('all')
              else {
                const id = Number(v)
                // 选自己等价「只看我的」（含未指派），与看板点自己头像语义一致
                setFilter(id === me ? 'me' : id)
              }
            }}
            aria-label="按成员筛选"
            style={{
              height: 28,
              borderRadius: 6,
              border: `1px solid ${byUser ? 'var(--accent)' : 'var(--border)'}`,
              background: 'var(--card)',
              color: byUser ? 'var(--accent)' : 'var(--dim)',
              fontSize: 12,
              padding: '0 26px 0 9px',
              cursor: 'pointer',
              appearance: 'none',
            }}
          >
            <option value="">按人筛选…</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
                {m.userId === me ? '（我）' : ''}
              </option>
            ))}
          </select>
        </SelectWrap>
      )}
    </div>
  )
}
