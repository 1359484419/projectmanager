// 共享负责人筛选状态：localStorage 持久化（key pm-assignee-filter），三页（看板/Backlog/Dashboard）联动。
// 核心判定逻辑在 assigneeFilterCore.ts（纯函数，可单测）；本文件只做 store + hook 接线。
import { useSyncExternalStore } from 'react'
import { currentUserId } from '../api/client'
import {
  parseAssigneeFilter,
  serializeAssigneeFilter,
  matchesAssignee as matchesAssigneeCore,
  type AssigneeFilter,
} from './assigneeFilterCore'

export type { AssigneeFilter }
export { currentUserId }

export const ASSIGNEE_FILTER_KEY = 'pm-assignee-filter'

// ---------- 模块级 store（useSyncExternalStore 外部源） ----------

let snapshot: AssigneeFilter | null = null
const listeners = new Set<() => void>()

function getSnapshot(): AssigneeFilter {
  if (snapshot == null) {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(ASSIGNEE_FILTER_KEY)
    } catch {
      // localStorage 不可用时按默认 'me'
    }
    snapshot = parseAssigneeFilter(raw)
  }
  return snapshot
}

export function setAssigneeFilter(value: AssigneeFilter) {
  snapshot = value
  try {
    localStorage.setItem(ASSIGNEE_FILTER_KEY, serializeAssigneeFilter(value))
  } catch {
    // 持久化失败不阻断本会话内联动
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 三页共享的负责人筛选：const [filter, setFilter] = useAssigneeFilter() */
export function useAssigneeFilter(): [AssigneeFilter, (value: AssigneeFilter) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot)
  return [value, setAssigneeFilter]
}

/** 页面侧便捷判定：自动带入当前登录用户 id */
export function taskMatchesFilter(
  assigneeId: number | null | undefined,
  filter: AssigneeFilter,
): boolean {
  return matchesAssigneeCore(assigneeId, filter, currentUserId())
}
