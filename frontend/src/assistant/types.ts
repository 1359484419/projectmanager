// 助手面板与 Python 服务之间的线上契约（经 Java 反代原样透传）。
// 字段与 spec §5.2 逐字段一致，一律 camelCase；Python 侧只在 schemas.py 的 to_wire() 转换。

/** 工具风险等级：L0 只读 / L1 创建可逆 / L2 修改需确认 / L3 删除需二次确认 */
export type Risk = 'L0' | 'L1' | 'L2' | 'L3'

export type DecisionType = 'approve' | 'edit' | 'reject'

/** 确认卡里的单字段 diff */
export interface CardChange {
  field: string
  label: string
  before: unknown
  after: unknown
}

/** 确认卡（L2/L3 操作，由 guard 节点生成，数据来自工具「先读」的现状，不来自模型文本） */
export interface Card {
  callId: string
  tool: string
  risk: Risk
  title: string
  /** 目标对象展示，如 "PM-12 登录页接入短信验证" */
  target: string
  changes: CardChange[]
  impact: string
  /** 「修改后确认」允许编辑的 args 字段名 */
  editable: string[]
  args: Record<string, unknown>
  /** ISO 时间；过期后按钮置灰 */
  expiresAt: string
  allowedDecisions: DecisionType[]
}

/** 结果卡（L1 创建类执行后的回显，数据来自工具返回） */
export interface ResultCard {
  callId: string
  tool: string
  /** 如 "已创建任务" */
  title: string
  /** 展示号，如 PM-58；「撤销创建」按它发起删除。无展示号的 L1（如已读通知）不带 */
  key?: string
  /** 一行摘要，如 "类型 TASK · 2 天 · 待办 · 负责人：我" */
  summary: string
  /** 「打开」跳转路径（可选，站内相对路径） */
  path?: string
  /** 是否提供「撤销创建」（无展示号时为 false） */
  undoable?: boolean
}

export interface Fallback {
  label: string
  path: string
}

export type SseEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; callId: string; tool: string; label: string; risk: Risk }
  | { type: 'tool_result'; callId: string; ok: boolean; summary?: string; code?: string; message?: string; data?: unknown }
  | { type: 'confirm'; callId: string; card: Card }
  | { type: 'result_card'; callId: string; card: ResultCard }
  | { type: 'done'; usage: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; code: string; message: string; fallback?: Fallback }

export type Decision =
  | { callId: string; type: 'approve' }
  | { callId: string; type: 'reject'; message?: string }
  | { callId: string; type: 'edit'; args: Record<string, unknown> }

/** GET /threads/{id} 的恢复载荷（刷新页面后恢复面板） */
export interface ThreadSnapshot {
  threadId: string
  messages: ({ role: 'user' | 'assistant'; text: string } | { role: 'tool'; callId: string; tool: string; ok: boolean })[]
  pendingCards: Card[]
}
