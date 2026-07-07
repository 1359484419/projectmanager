// 任务估点（story points）规则：0.5-5，0.5 步进。与后端 TaskService.validatePoints 对齐。
// 纯模块（无 DOM / React 依赖），tests/unit/points.test.ts 直测。

export const POINTS_MIN = 0.5
export const POINTS_MAX = 5
export const POINTS_STEP = 0.5

/** 超范围/非法输入的统一提示文案 */
export const POINTS_RANGE_MSG = '单任务估点 0.5-5，过大请拆分'

/** 估点档位：0.5, 1, 1.5, …, 5 */
export const POINTS_CHOICES: number[] = Array.from({ length: 10 }, (_, i) => (i + 1) * POINTS_STEP)

/**
 * 解析用户输入的估点：
 * - 空串 → null（未估点）；
 * - 合法（0.5-5 且 0.5 倍数）→ number；
 * - 其余 → undefined（应拒绝并提示 POINTS_RANGE_MSG）。
 */
export function parsePointsInput(raw: string): number | null | undefined {
  const s = raw.trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return undefined
  if (n < POINTS_MIN || n > POINTS_MAX) return undefined
  if (!Number.isInteger(n * 2)) return undefined
  return n
}

/** points 展示：整数不带小数点，小数保留一位（浮点求和误差收敛到 0.1） */
export function fmtPoints(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
}
