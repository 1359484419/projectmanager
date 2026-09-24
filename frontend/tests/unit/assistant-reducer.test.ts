// 单测：助手面板消息流 reducer（纯函数）。SSE 事件 → ChatItem[] 的映射规则：
// text_delta 累加到同一条 assistant；confirm 追加卡片；tool_result 改对应 tool 行状态；
// error 生成错误卡；done 不新增条目。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, decisionStatus, reduce, type ChatItem } from '../../src/assistant/reducer.ts'
import type { Card, ResultCard } from '../../src/assistant/types.ts'

const card: Card = {
  callId: 'c3',
  tool: 'update_task_status',
  risk: 'L2',
  title: '修改任务状态',
  target: 'PM-12 登录页接入短信验证',
  changes: [{ field: 'status', label: '状态', before: 'IN_PROGRESS', after: 'COMPLETED' }],
  impact: '会触发燃尽图与通知；可回退',
  editable: ['status'],
  args: { key: 'PM-12', status: 'COMPLETED' },
  expiresAt: '2026-09-24T10:10:00Z',
  allowedDecisions: ['approve', 'edit', 'reject'],
}

test('reduce: 连续 text_delta 累加到同一条 assistant', () => {
  let items: ChatItem[] = [{ kind: 'user', text: '你好' }]
  items = reduce(items, { type: 'text_delta', text: '好的，' })
  items = reduce(items, { type: 'text_delta', text: '我先看一下' })
  assert.deepEqual(items, [
    { kind: 'user', text: '你好' },
    { kind: 'assistant', text: '好的，我先看一下' },
  ])
})

test('reduce: 中间隔了工具行后的 text_delta 另起一条 assistant', () => {
  let items: ChatItem[] = []
  items = reduce(items, { type: 'text_delta', text: '先查' })
  items = reduce(items, { type: 'tool_start', callId: 'c1', tool: 'list_my_tasks', label: '查询我的任务', risk: 'L0' })
  items = reduce(items, { type: 'text_delta', text: '查到了' })
  assert.equal(items.length, 3)
  assert.deepEqual(items[0], { kind: 'assistant', text: '先查' })
  assert.deepEqual(items[2], { kind: 'assistant', text: '查到了' })
})

test('reduce: tool_start 追加 running 行，tool_result ok 置 ok 并带 summary', () => {
  let items: ChatItem[] = []
  items = reduce(items, { type: 'tool_start', callId: 'c1', tool: 'list_my_tasks', label: '查询我的任务', risk: 'L0' })
  assert.deepEqual(items, [{ kind: 'tool', callId: 'c1', label: '查询我的任务', status: 'running' }])
  items = reduce(items, { type: 'tool_result', callId: 'c1', ok: true, summary: '3 条任务', data: [] })
  assert.deepEqual(items, [{ kind: 'tool', callId: 'c1', label: '查询我的任务', status: 'ok', summary: '3 条任务' }])
})

test('reduce: tool_result 失败置 error，summary 取 message', () => {
  let items: ChatItem[] = reduce([], { type: 'tool_start', callId: 'c2', tool: 'get_task', label: '查询任务', risk: 'L0' })
  items = reduce(items, { type: 'tool_result', callId: 'c2', ok: false, code: 'NOT_FOUND', message: '任务 PM-99 不存在' })
  assert.deepEqual(items, [{ kind: 'tool', callId: 'c2', label: '查询任务', status: 'error', summary: '任务 PM-99 不存在' }])
})

test('reduce: tool_result 只改对应 callId，其他行不动', () => {
  let items: ChatItem[] = []
  items = reduce(items, { type: 'tool_start', callId: 'a', tool: 'x', label: 'A', risk: 'L0' })
  items = reduce(items, { type: 'tool_start', callId: 'b', tool: 'y', label: 'B', risk: 'L0' })
  items = reduce(items, { type: 'tool_result', callId: 'b', ok: true })
  assert.equal((items[0] as { status: string }).status, 'running')
  assert.equal((items[1] as { status: string }).status, 'ok')
})

test('reduce: confirm 追加确认卡（未决策）', () => {
  const items = reduce([{ kind: 'assistant', text: '需要确认' }], { type: 'confirm', callId: 'c3', card })
  assert.equal(items.length, 2)
  assert.deepEqual(items[1], { kind: 'confirm', card })
})

test('reduce: result_card 追加结果卡', () => {
  const rc: ResultCard = { callId: 'c4', tool: 'create_task', title: '已创建任务', key: 'PM-58', summary: '类型 TASK · 2 天 · 待办', undoable: true }
  const items = reduce([], { type: 'result_card', callId: 'c4', card: rc })
  assert.deepEqual(items, [{ kind: 'result', card: rc }])
})

test('reduce: error 生成错误卡（含 fallback）', () => {
  const items = reduce([], {
    type: 'error',
    code: 'LLM_UNAVAILABLE',
    message: '助手暂时不可用',
    fallback: { label: '去看板手动操作', path: '/t/acme/board' },
  })
  assert.deepEqual(items, [
    { kind: 'error', code: 'LLM_UNAVAILABLE', message: '助手暂时不可用', fallback: { label: '去看板手动操作', path: '/t/acme/board' } },
  ])
})

test('reduce: done 不新增条目', () => {
  const before: ChatItem[] = [{ kind: 'assistant', text: '完成' }]
  const after = reduce(before, { type: 'done', usage: { promptTokens: 10, completionTokens: 5 } })
  assert.deepEqual(after, before)
})

test('reduce: 纯函数，不修改入参数组', () => {
  const before: ChatItem[] = [{ kind: 'assistant', text: 'a' }]
  const snapshot = JSON.stringify(before)
  reduce(before, { type: 'text_delta', text: 'b' })
  reduce(before, { type: 'tool_start', callId: 'c', tool: 't', label: 'L', risk: 'L1' })
  assert.equal(JSON.stringify(before), snapshot)
})

test('applyDecision: 给对应 callId 的确认卡打上 decided', () => {
  const items: ChatItem[] = [{ kind: 'confirm', card }, { kind: 'confirm', card: { ...card, callId: 'c9' } }]
  const out = applyDecision(items, { callId: 'c3', type: 'reject', message: '不要' })
  assert.deepEqual(out[0], { kind: 'confirm', card, decided: { callId: 'c3', type: 'reject', message: '不要' } })
  assert.equal((out[1] as { decided?: unknown }).decided, undefined)
})

test('reduce: 同 callId 的 confirm 二次到达（409 重出卡）时原地替换、清空 decided，并收尾仍在执行中的 tool 行', () => {
  let items: ChatItem[] = reduce([{ kind: 'user', text: 'x' }], { type: 'confirm', callId: 'c3', card })
  items = applyDecision(items, { callId: 'c3', type: 'approve' })
  items = reduce(items, { type: 'tool_start', callId: 'c3', tool: 'update_task_status', label: '修改任务状态', risk: 'L2' })
  const recard: Card = { ...card, impact: '对象已被他人修改，请再次确认。会立即生效', expiresAt: '2026-09-24T10:20:00Z' }
  items = reduce(items, { type: 'confirm', callId: 'c3', card: recard })
  const confirms = items.filter((it) => it.kind === 'confirm')
  assert.equal(confirms.length, 1)
  assert.deepEqual(confirms[0], { kind: 'confirm', card: recard })          // 位置保留、decided 已清
  assert.equal(items.findIndex((it) => it.kind === 'confirm'), 1)
  const tool = items.find((it) => it.kind === 'tool') as { status: string; summary?: string }
  assert.equal(tool.status, 'error')
  assert.equal(tool.summary, '对象已被他人修改，请再次确认')
  // 对新卡再决策只影响这一张
  const out = applyDecision(items, { callId: 'c3', type: 'reject' })
  assert.deepEqual(out.filter((it) => it.kind === 'confirm').map((it) => (it as { decided?: { type: string } }).decided?.type), ['reject'])
})

test('reduce: confirm 之前已有 tool_result 收尾的 tool 行不被 confirm 改写', () => {
  let items: ChatItem[] = reduce([], { type: 'tool_start', callId: 'c3', tool: 'x', label: 'A', risk: 'L2' })
  items = reduce(items, { type: 'tool_result', callId: 'c3', ok: false, code: 'CONFLICT', message: '已被修改' })
  items = reduce(items, { type: 'confirm', callId: 'c3', card })
  assert.deepEqual(items[0], { kind: 'tool', callId: 'c3', label: 'A', status: 'error', summary: '已被修改' })
})

test('reduce: 决策后服务端回 tool_result{ok:false}（INVALID_PARAMS / CARD_EXPIRED）→ 该卡记下失败 outcome，不再是「提交即成功」', () => {
  let items: ChatItem[] = reduce([], { type: 'confirm', callId: 'c3', card })
  items = applyDecision(items, { callId: 'c3', type: 'edit', args: { status: 'DONE' } })
  const decided = { callId: 'c3', type: 'edit', args: { status: 'DONE' } } as const
  assert.equal(decisionStatus(decided), 'submitted')            // 还没拿到结果：只算「已提交」
  // 系统拒绝不发 tool_start，只发 tool_result：没有 tool 行也要落到卡上
  items = reduce(items, { type: 'tool_result', callId: 'c3', ok: false, code: 'INVALID_PARAMS', message: '修改后的参数无效: points 必须在 0.5-5' })
  assert.deepEqual(items, [{ kind: 'confirm', card, decided, outcome: { ok: false, code: 'INVALID_PARAMS', message: '修改后的参数无效: points 必须在 0.5-5' } }])
  assert.equal(decisionStatus(decided, { ok: false, code: 'INVALID_PARAMS' }), 'failed')
  const expired = reduce([{ kind: 'confirm', card, decided: { callId: 'c3', type: 'approve' } }], { type: 'tool_result', callId: 'c3', ok: false, code: 'CARD_EXPIRED', message: '已过期' })
  assert.equal(decisionStatus({ callId: 'c3', type: 'approve' }, (expired[0] as { outcome?: { ok: boolean } }).outcome), 'failed')
})

test('reduce: 正常执行的 tool_start → tool_result{ok:true} 把卡标成已执行，同时收尾 tool 行；其他卡不动', () => {
  let items: ChatItem[] = reduce([], { type: 'confirm', callId: 'c3', card })
  items = reduce(items, { type: 'confirm', callId: 'c9', card: { ...card, callId: 'c9' } })
  items = applyDecision(items, { callId: 'c3', type: 'approve' })
  items = applyDecision(items, { callId: 'c9', type: 'approve' })
  items = reduce(items, { type: 'tool_start', callId: 'c3', tool: 'update_task_status', label: '修改任务状态', risk: 'L2' })
  items = reduce(items, { type: 'tool_result', callId: 'c3', ok: true, summary: 'PM-12「登录页」' })
  const [a, b, tool] = items as [{ outcome?: { ok: boolean } }, { outcome?: unknown }, { status: string; summary?: string }]
  assert.deepEqual(a.outcome, { ok: true })
  assert.equal(b.outcome, undefined)
  assert.equal(tool.status, 'ok')
  assert.equal(tool.summary, 'PM-12「登录页」')
  assert.equal(decisionStatus({ callId: 'c3', type: 'approve' }, a.outcome), 'done')
})

test('decisionStatus: 取消的卡与结果无关一律 rejected', () => {
  assert.equal(decisionStatus({ callId: 'c3', type: 'reject' }), 'rejected')
  assert.equal(decisionStatus({ callId: 'c3', type: 'reject' }, { ok: false, code: 'X' }), 'rejected')
})

test('applyDecision / 重出卡: 重新决策时上次的 outcome 作废', () => {
  let items: ChatItem[] = [{ kind: 'confirm', card, decided: { callId: 'c3', type: 'approve' }, outcome: { ok: false, code: 'CONFLICT', message: '已被修改' } }]
  items = reduce(items, { type: 'confirm', callId: 'c3', card })          // 409 重出卡：原地替换，outcome/decided 都清
  assert.deepEqual(items, [{ kind: 'confirm', card }])
  const again = applyDecision([{ kind: 'confirm', card, decided: { callId: 'c3', type: 'approve' }, outcome: { ok: false, code: 'X' } }], { callId: 'c3', type: 'edit', args: { status: 'DONE' } })
  assert.deepEqual(again, [{ kind: 'confirm', card, decided: { callId: 'c3', type: 'edit', args: { status: 'DONE' } } }])
  assert.ok(!('outcome' in again[0]))
})
