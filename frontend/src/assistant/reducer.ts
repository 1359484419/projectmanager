// 助手面板消息流的纯 reducer：SSE 事件 → ChatItem[]。无副作用，便于单测；
// 副作用（发请求、失效缓存、决策收集）都在 useAssistant.ts。
import { POINTS_CHOICES, parsePointsInput } from '../utils/points.ts'   // 带扩展名：node --test 直跑 .ts 需要（tsconfig allowImportingTsExtensions）
import type { Card, Decision, Fallback, ResultCard, Risk, SseEvent } from './types'

/** 决策提交后服务端的真实结果（tool_result）：ok=false 表示这次没执行（INVALID_PARAMS / CARD_EXPIRED / INVALID_DECISION / 后端错误…） */
export interface CardOutcome {
  ok: boolean
  code?: string
  message?: string
}

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; callId: string; label: string; status: 'running' | 'ok' | 'error'; summary?: string }
  | { kind: 'confirm'; card: Card; decided?: Decision; outcome?: CardOutcome }
  | { kind: 'result'; card: ResultCard }
  | { kind: 'error'; code: string; message: string; fallback?: Fallback }

export function reduce(items: ChatItem[], ev: SseEvent): ChatItem[] {
  switch (ev.type) {
    case 'text_delta': {
      const last = items[items.length - 1]
      if (last && last.kind === 'assistant') {
        return [...items.slice(0, -1), { kind: 'assistant', text: last.text + ev.text }]
      }
      return [...items, { kind: 'assistant', text: ev.text }]
    }
    case 'tool_start': {
      // 续跑重放时同一 callId 的 tool_start 可能再次到达：更新原行而不是追加（React key 也不会重复）
      const row: ChatItem = { kind: 'tool', callId: ev.callId, label: ev.label, status: 'running' }
      const idx = items.findIndex((it) => it.kind === 'tool' && it.callId === ev.callId)
      if (idx >= 0) return [...items.slice(0, idx), row, ...items.slice(idx + 1)]
      return [...items, row]
    }
    case 'tool_result': {
      const summary = ev.summary ?? ev.message
      let found = false
      const next = items.map((it): ChatItem => {
        if (it.kind === 'confirm' && it.card.callId === ev.callId) {
          // 该卡的真实执行结果：系统拒绝（INVALID_PARAMS / CARD_EXPIRED…）时服务端不发 tool_start 只发 tool_result，
          // 卡片据此从「已提交」改成失败态，而不是提交即成功
          found = true
          const outcome: CardOutcome = { ok: ev.ok }
          if (ev.code !== undefined) outcome.code = ev.code
          if (ev.message !== undefined) outcome.message = ev.message
          return { ...it, outcome }
        }
        if (it.kind !== 'tool' || it.callId !== ev.callId) return it
        found = true
        const out: ChatItem = { kind: 'tool', callId: it.callId, label: it.label, status: ev.ok ? 'ok' : 'error' }
        if (summary !== undefined) out.summary = summary
        return out
      })
      // 既没有对应的 tool_start 也没有对应的卡（协议异常）时不凭空造行，原样返回
      return found ? next : items
    }
    case 'confirm': {
      // 409 重出卡：Python 对同一 callId 再发一次 confirm → 原地替换（清掉旧决策，需要重新确认），不追加（React key 不重复）
      const idx = items.findIndex((it) => it.kind === 'confirm' && it.card.callId === ev.callId)
      const fresh: ChatItem = { kind: 'confirm', card: ev.card }
      if (idx < 0) return [...items, fresh]
      const summary = ev.card.impact.split(/[。.]/)[0]
      return items.map((it, i): ChatItem => {
        if (i === idx) return fresh
        // 该调用的 tool 行若还在「执行中」（协议上 tool_result 可能缺席），按冲突收尾
        if (it.kind === 'tool' && it.callId === ev.callId && it.status === 'running') {
          return { kind: 'tool', callId: it.callId, label: it.label, status: 'error', summary }
        }
        return it
      })
    }
    case 'result_card':
      return [...items, { kind: 'result', card: ev.card }]
    case 'error': {
      const item: ChatItem = { kind: 'error', code: ev.code, message: ev.message }
      if (ev.fallback) item.fallback = ev.fallback
      return [...items, item]
    }
    case 'done':
      return items
    default:
      return items
  }
}

/** 给对应 callId 的确认卡记下用户决策（用于置灰按钮与显示"已确认/已取消"） */
export function applyDecision(items: ChatItem[], d: Decision): ChatItem[] {
  return items.map((it): ChatItem => {
    if (it.kind !== 'confirm' || it.card.callId !== d.callId) return it
    const next: ChatItem = { ...it, decided: d }
    delete next.outcome   // 重新决策（如 409 重出卡后）：上次的执行结果作废
    return next
  })
}

/** 决策后的展示态：提交中（尚无 tool_result）/ 已执行 / 未执行（服务端拒绝）/ 已取消 */
export type DecisionStatus = 'submitted' | 'done' | 'failed' | 'rejected'
export function decisionStatus(decided: Decision, outcome?: CardOutcome): DecisionStatus {
  if (decided.type === 'reject') return 'rejected'
  if (!outcome) return 'submitted'
  return outcome.ok ? 'done' : 'failed'
}

/** 卡片是否已过期（expiresAt 非法时视为不过期，交给服务端判定） */
export function cardExpired(card: Card, now: number): boolean {
  const at = Date.parse(card.expiresAt)
  return Number.isFinite(at) && now > at
}

/** 尚未决策且未过期的确认卡：只有这些会阻塞输入框；过期的由 useAssistant 在发送前自动取消 */
export function pendingCards(items: ChatItem[], now: number = Date.now()): Card[] {
  const out: Card[] = []
  for (const it of items) if (it.kind === 'confirm' && !it.decided && !cardExpired(it.card, now)) out.push(it.card)
  return out
}

/** 尚未决策但已过期的确认卡（服务端对它们的任何决策都会回 CARD_EXPIRED 并结束本轮） */
export function expiredPendingCards(items: ChatItem[], now: number = Date.now()): Card[] {
  const out: Card[] = []
  for (const it of items) if (it.kind === 'confirm' && !it.decided && cardExpired(it.card, now)) out.push(it.card)
  return out
}

/**
 * 「修改后确认」表单的控件类型：任务状态 → 下拉（枚举码）；长期计划状态（update_epic）→ OPEN/DONE 下拉；
 * 天数 → 0.5-5 档位下拉；布尔 → 复选框；容量等数值 → 数字框；其余文本。
 * 枚举字段一律下拉：中文输入/越界数字在前端就进不去，不会被后端 INVALID_PARAMS 拒。
 */
export type EditControl = 'status' | 'epicStatus' | 'points' | 'boolean' | 'number' | 'text'
const NUMERIC_FIELDS = new Set(['capacity'])
export function editControlKind(field: string, orig: unknown, tool?: string): EditControl {
  if (field === 'status') return tool === 'update_epic' ? 'epicStatus' : 'status'
  if (field === 'points') return 'points'
  if (typeof orig === 'boolean') return 'boolean'
  if (typeof orig === 'number' || NUMERIC_FIELDS.has(field)) return 'number'
  return 'text'
}

/** 天数下拉的选项：0.5-5 十档；原值不在档位内（历史数据）时一并列出，保证下拉能显示当前值 */
export function pointsOptions(orig: unknown): number[] {
  if (typeof orig === 'number' && Number.isFinite(orig) && !POINTS_CHOICES.includes(orig)) {
    return [...POINTS_CHOICES, orig].sort((a, b) => a - b)
  }
  return POINTS_CHOICES
}

/** 把服务端告知的挂起卡（409 THREAD_PENDING 的 pendingCards / GET 恢复）补进消息流；已有的不重复，无变化时返回原数组 */
export function mergePendingCards(items: ChatItem[], cards: Card[]): ChatItem[] {
  const have = new Set<string>()
  for (const it of items) if (it.kind === 'confirm') have.add(it.card.callId)
  const missing = cards.filter((c) => !have.has(c.callId))
  if (missing.length === 0) return items
  return [...items, ...missing.map((card): ChatItem => ({ kind: 'confirm', card }))]
}

/**
 * 「修改后确认」的提交体：只含该卡 editable 字段里用户真正改动过的（spec §6.2 提交 {type:'edit', args:{仅可编辑字段}}）。
 * 空串视为未改动（不会把 '' 发给数字字段或清空描述）；按控件类型（editControlKind）还原 number / boolean；非法数字、越界天数不发。
 */
export function buildEditArgs(card: Card, draft: Record<string, string>): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const f of card.editable) {
    const raw = (draft[f] ?? '').trim()
    if (raw === '') continue
    const orig = card.args[f] ?? card.changes.find((c) => c.field === f)?.after
    const kind = editControlKind(f, orig, card.tool)
    let value: unknown = raw
    if (kind === 'points') {
      // 与后端 validate_points 同规则（0.5-5、0.5 步进）：越界/非档位不发，免得被 INVALID_PARAMS 拒
      const n = parsePointsInput(raw)
      if (n === null || n === undefined) continue
      value = n
    } else if (kind === 'number') {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      value = n
    } else if (kind === 'boolean') {
      if (raw !== 'true' && raw !== 'false') continue
      value = raw === 'true'
    }
    if (orig !== undefined && orig !== null && JSON.stringify(value) === JSON.stringify(orig)) continue
    args[f] = value
  }
  return args
}

/** 只有写操作（tool_start 时记下的 risk != L0）成功才失效查询缓存；未知 callId 保守按写处理 */
export function shouldInvalidate(risks: Map<string, Risk>, ev: SseEvent): boolean {
  if (ev.type === 'result_card') return true
  if (ev.type !== 'tool_result' || !ev.ok) return false
  return (risks.get(ev.callId) ?? 'L1') !== 'L0'
}
