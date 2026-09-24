// 单测：确认卡「修改后确认」提交体与多卡/挂起卡的纯函数（useAssistant / ConfirmCard 的逻辑抽出来测）。
// - buildEditArgs 只提交 editable 字段：空串/未改动的不发，定位字段（taskKey）不发；按原值类型还原 number/boolean。
// - mergePendingCards 把 409 THREAD_PENDING / GET 恢复的挂起卡补进消息流，已有的不重复。
// - shouldInvalidate 只在写操作（risk != L0）成功时才失效查询缓存。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEditArgs, editControlKind, expiredPendingCards, mergePendingCards, pendingCards, pointsOptions, reduce, shouldInvalidate, type ChatItem } from '../../src/assistant/reducer.ts'
import type { Card } from '../../src/assistant/types.ts'

const statusCard: Card = {
  callId: 'c1',
  tool: 'update_task_status',
  risk: 'L2',
  title: '修改任务状态 PM-12「登录页」',
  target: 'PM-12 登录页',
  changes: [{ field: 'status', label: '状态', before: 'IN_PROGRESS', after: 'COMPLETED' }],
  impact: 'x',
  editable: ['status'],
  args: { taskKey: 'PM-12', status: 'COMPLETED' },
  expiresAt: '2026-09-24T10:10:00Z',
  allowedDecisions: ['approve', 'edit', 'reject'],
}

const updateCard: Card = {
  ...statusCard,
  callId: 'c2',
  tool: 'update_task',
  changes: [{ field: 'points', label: '天数', before: 2, after: 3 }],
  editable: ['title', 'description', 'points', 'assignee'],
  args: { taskKey: 'PM-12', points: 3 },
}

const subtaskCard: Card = {
  ...statusCard,
  callId: 'c3',
  tool: 'update_subtask',
  changes: [{ field: 'done', label: '完成', before: false, after: true }],
  editable: ['done', 'newTitle'],
  args: { taskKey: 'PM-12', subtaskTitle: '写用例', done: true },
}

test('buildEditArgs: 只含 editable 且改动过的字段，定位字段不发', () => {
  assert.deepEqual(buildEditArgs(statusCard, { status: 'DONE' }), { status: 'DONE' })
  assert.deepEqual(buildEditArgs(statusCard, { status: 'COMPLETED' }), {})          // 未改动 → 不发
  assert.deepEqual(buildEditArgs(statusCard, { status: '' }), {})                   // 空串视为未改动
  assert.ok(!('taskKey' in buildEditArgs(statusCard, { status: 'DONE', taskKey: 'PM-13' })))
})

test('buildEditArgs: 数字/布尔按原值类型还原，模型未给的字段填了才发', () => {
  assert.deepEqual(buildEditArgs(updateCard, { title: '', description: '', points: '2.5', assignee: '' }), { points: 2.5 })
  assert.deepEqual(buildEditArgs(updateCard, { title: '新标题', points: '3' }), { title: '新标题' })
  assert.deepEqual(buildEditArgs(updateCard, { points: 'abc' }), {})                // 非法数字不发（后端不会收到 ''/NaN）
  assert.deepEqual(buildEditArgs(subtaskCard, { done: 'false', newTitle: '' }), { done: false })
  assert.deepEqual(buildEditArgs(subtaskCard, { done: 'true', newTitle: '改名' }), { newTitle: '改名' })
})

test('mergePendingCards: 补进缺失的挂起卡，已有的不重复', () => {
  const items: ChatItem[] = [{ kind: 'user', text: 'x' }, { kind: 'confirm', card: statusCard }]
  const out = mergePendingCards(items, [statusCard, updateCard])
  assert.equal(out.length, 3)
  assert.deepEqual(out[2], { kind: 'confirm', card: updateCard })
  assert.equal(mergePendingCards(out, [statusCard, updateCard]), out)          // 无变化时返回原数组
  assert.deepEqual(pendingCards(out, Date.parse('2026-09-24T10:00:00Z')).map((c) => c.callId), ['c1', 'c2'])   // 固定时钟：卡片在夹具时间内未过期
})

test('reduce: 同 callId 的 tool_start 重复到达时更新而不追加（续跑重放）', () => {
  let items: ChatItem[] = reduce([], { type: 'tool_start', callId: 'c1', tool: 'x', label: 'A', risk: 'L2' })
  items = reduce(items, { type: 'tool_result', callId: 'c1', ok: false, code: 'TOKEN_EXPIRED', message: '过期' })
  items = reduce(items, { type: 'tool_start', callId: 'c1', tool: 'x', label: 'A', risk: 'L2' })
  assert.deepEqual(items, [{ kind: 'tool', callId: 'c1', label: 'A', status: 'running' }])
})

test('shouldInvalidate: 只读工具成功不失效缓存，写操作成功才失效', () => {
  const risks = new Map([['r1', 'L0' as const], ['w1', 'L1' as const], ['w2', 'L2' as const]])
  assert.equal(shouldInvalidate(risks, { type: 'tool_result', callId: 'r1', ok: true }), false)
  assert.equal(shouldInvalidate(risks, { type: 'tool_result', callId: 'w1', ok: true }), true)
  assert.equal(shouldInvalidate(risks, { type: 'tool_result', callId: 'w2', ok: false, code: 'X', message: 'x' }), false)
  assert.equal(shouldInvalidate(risks, { type: 'tool_result', callId: 'unknown', ok: true }), true)   // 未知等级按写处理（保守）
  assert.equal(shouldInvalidate(risks, { type: 'result_card', callId: 'w1', card: { callId: 'w1', tool: 'create_task', title: 't', summary: '' } }), true)
  assert.equal(shouldInvalidate(risks, { type: 'text_delta', text: 'x' }), false)
})

test('pendingCards: 过期的卡不再算挂起（不阻塞输入框）；expiredPendingCards 单独列出供自动取消', () => {
  const fresh: Card = { ...statusCard, callId: 'f1', expiresAt: '2026-09-24T10:10:00Z' }
  const stale: Card = { ...statusCard, callId: 's1', expiresAt: '2026-09-24T09:00:00Z' }
  const items: ChatItem[] = [{ kind: 'confirm', card: fresh }, { kind: 'confirm', card: stale }, { kind: 'confirm', card: stale, decided: { callId: 's1', type: 'reject' } }]
  const now = Date.parse('2026-09-24T10:00:00Z')
  assert.deepEqual(pendingCards(items, now).map((c) => c.callId), ['f1'])
  assert.deepEqual(expiredPendingCards(items, now).map((c) => c.callId), ['s1'])
  // 时间过了：全部过期 → 没有挂起卡，输入框不再被锁死
  const later = Date.parse('2026-09-24T10:11:00Z')
  assert.deepEqual(pendingCards(items, later), [])
  assert.deepEqual(expiredPendingCards(items, later).map((c) => c.callId), ['f1', 's1'])
  // 非法的 expiresAt 视为不过期
  assert.deepEqual(pendingCards([{ kind: 'confirm', card: { ...fresh, expiresAt: 'nope' } }], later).map((c) => c.callId), ['f1'])
})

test('editControlKind: 状态字段用下拉（枚举码提交、中文显示），布尔用复选框，天数用档位下拉，容量用数字框，其余文本', () => {
  assert.equal(editControlKind('status', 'COMPLETED'), 'status')
  assert.equal(editControlKind('status', 'COMPLETED', 'update_task_status'), 'status')
  assert.equal(editControlKind('status', 'OPEN', 'update_epic'), 'epicStatus')   // 长期计划状态是 OPEN/DONE，不能给任务状态四态
  assert.equal(editControlKind('done', false), 'boolean')
  assert.equal(editControlKind('points', 3), 'points')
  assert.equal(editControlKind('points', undefined), 'points')      // 模型没给天数时也按档位下拉
  assert.equal(editControlKind('capacity', 5), 'number')
  assert.equal(editControlKind('title', '新标题'), 'text')
  assert.equal(editControlKind('assignee', undefined), 'text')
})

test('pointsOptions: 0.5-5 十档；原值不在档位内时一并列出（下拉能显示当前值）', () => {
  assert.deepEqual(pointsOptions(3), [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
  assert.deepEqual(pointsOptions(undefined), [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
  assert.deepEqual(pointsOptions(8), [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 8])
  assert.deepEqual(pointsOptions('3'), [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
})

test('buildEditArgs: 天数按 0.5-5 / 0.5 步进校验，越界或非档位不发（后端 validate_points 同规则）', () => {
  assert.deepEqual(buildEditArgs(updateCard, { points: '7' }), {})
  assert.deepEqual(buildEditArgs(updateCard, { points: '0' }), {})
  assert.deepEqual(buildEditArgs(updateCard, { points: '-1' }), {})
  assert.deepEqual(buildEditArgs(updateCard, { points: '2.3' }), {})
  assert.deepEqual(buildEditArgs(updateCard, { points: '5' }), { points: 5 })
  assert.deepEqual(buildEditArgs(updateCard, { points: '0.5' }), { points: 0.5 })
  assert.deepEqual(buildEditArgs(updateCard, { points: ' 4.5 ' }), { points: 4.5 })
  // 容量仍是普通数字框，不受天数档位限制
  const capCard: Card = { ...statusCard, callId: 'c4', tool: 'set_capacity', changes: [], editable: ['capacity'], args: { sprint: 'S1', capacity: 10 } }
  assert.deepEqual(buildEditArgs(capCard, { capacity: '12' }), { capacity: 12 })
})

test('buildEditArgs: 长期计划状态提交 OPEN/DONE 枚举码', () => {
  const epicCard: Card = { ...statusCard, callId: 'c5', tool: 'update_epic', changes: [{ field: 'status', label: '状态', before: 'OPEN', after: 'DONE' }], editable: ['name', 'description', 'quarter', 'status'], args: { epicName: '登录改版', status: 'DONE' } }
  assert.deepEqual(buildEditArgs(epicCard, { status: 'OPEN' }), { status: 'OPEN' })
  assert.deepEqual(buildEditArgs(epicCard, { status: 'DONE' }), {})   // 未改动不发
})

test('buildEditArgs: 下拉选出的枚举码原样提交；数字框按字段类型还原数字（原值缺省时也还原）', () => {
  assert.deepEqual(buildEditArgs(statusCard, { status: 'DONE' }), { status: 'DONE' })
  const noPoints: Card = { ...updateCard, args: { taskKey: 'PM-12' }, changes: [] }
  assert.deepEqual(buildEditArgs(noPoints, { points: '2.5' }), { points: 2.5 })
  assert.deepEqual(buildEditArgs(noPoints, { points: 'abc' }), {})
})
