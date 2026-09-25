// 迭代生命周期的纯判断（与后端 SprintService 规则对齐）。
import type { SprintStatus } from '../api/types'

/**
 * 启动 targetId 前是否被另一个 ACTIVE 迭代阻塞：后端同一项目只允许一个进行中的迭代
 * （409 ACTIVE_SPRINT_EXISTS），前端确认框据此提前告知并禁用启动。
 */
export function activeSprintBlocking<T extends { id: number; status: SprintStatus }>(
  sprints: readonly T[] | undefined,
  targetId: number,
): T | null {
  return sprints?.find((s) => s.status === 'ACTIVE' && s.id !== targetId) ?? null
}
