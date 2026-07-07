// 负责人筛选核心逻辑（纯函数，无 DOM / React 依赖，便于 node --test 直测）
// 值语义：'me' 只看我的（含未指派，避免新任务丢失感）| 'all' 全部 | number 指定成员 userId

export type AssigneeFilter = 'me' | 'all' | number

/** localStorage 原始值 → 筛选值；非法/缺省回退 'me' */
export function parseAssigneeFilter(raw: string | null): AssigneeFilter {
  if (raw === 'all') return 'all'
  if (raw == null || raw === 'me') return 'me'
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : 'me'
}

/** 筛选值 → localStorage 字符串（与 parseAssigneeFilter 互逆） */
export function serializeAssigneeFilter(value: AssigneeFilter): string {
  return String(value)
}

/**
 * 任务是否命中筛选：
 * - 'all'：全放行；
 * - 'me'：自己的任务 + 未指派任务（新任务默认未指派，不让它在默认视图里消失）；
 * - userId：只看该成员（不含未指派）。
 */
export function matchesAssignee(
  assigneeId: number | null | undefined,
  filter: AssigneeFilter,
  me: number | null,
): boolean {
  if (filter === 'all') return true
  if (filter === 'me') return assigneeId == null || assigneeId === me
  return assigneeId === filter
}
