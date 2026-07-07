// 单测：乐观锁 409 冲突识别（F9）。isConflictError 只认 409 + code=CONFLICT，
// 避免误吞成员移出等其他 409 语义（CANNOT_REMOVE_SELF / LAST_ADMIN）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, CONFLICT_TOAST, isConflictError } from '../../src/api/client.ts'

test('conflict: 409 + CONFLICT 命中', () => {
  assert.equal(isConflictError(new ApiError(409, 'CONFLICT', '任务已被他人修改')), true)
})

test('conflict: 409 但其他 code 不命中（成员移出语义）', () => {
  assert.equal(isConflictError(new ApiError(409, 'CANNOT_REMOVE_SELF', '不能移出自己')), false)
  assert.equal(isConflictError(new ApiError(409, 'LAST_ADMIN', '最后一位管理员')), false)
})

test('conflict: 非 409 不命中', () => {
  assert.equal(isConflictError(new ApiError(400, 'CONFLICT', '假冲突')), false)
  assert.equal(isConflictError(new ApiError(500, 'UNKNOWN', 'boom')), false)
})

test('conflict: 非 ApiError 不命中', () => {
  assert.equal(isConflictError(new Error('CONFLICT')), false)
  assert.equal(isConflictError(undefined), false)
  assert.equal(isConflictError(null), false)
  assert.equal(isConflictError('CONFLICT'), false)
})

test('conflict: 统一提示文案', () => {
  assert.equal(CONFLICT_TOAST, '该任务刚被他人修改，已刷新最新数据，请重试')
})
