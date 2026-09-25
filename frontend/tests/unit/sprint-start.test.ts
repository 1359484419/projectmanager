// 单测：启动迭代前置判断（审查 P1「启动第二个迭代的确认框文案与后端行为矛盾」）。
// 后端规则：已有 ACTIVE 迭代时拒绝启动（409 ACTIVE_SPRINT_EXISTS）；前端确认框须提前告知并禁用启动。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeSprintBlocking } from '../../src/utils/sprints.ts'

const sprints = [
  { id: 1, name: '迭代 1', status: 'ACTIVE' as const },
  { id: 2, name: '迭代 2', status: 'PLANNED' as const },
  { id: 3, name: '迭代 0', status: 'CLOSED' as const },
]

test('activeSprintBlocking: 存在进行中迭代时返回它', () => {
  assert.deepEqual(activeSprintBlocking(sprints, 2), sprints[0])
})

test('activeSprintBlocking: 无进行中迭代返回 null', () => {
  assert.equal(activeSprintBlocking([sprints[1], sprints[2]], 2), null)
  assert.equal(activeSprintBlocking(undefined, 2), null)
})

test('activeSprintBlocking: 目标就是进行中的那个（重复点启动）不算阻塞', () => {
  assert.equal(activeSprintBlocking(sprints, 1), null)
})
