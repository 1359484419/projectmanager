// 单测：后端错误统一中文映射（审查 P2「后端英文错误直出」+ P1「ACTIVE_SPRINT_EXISTS 裸英文」）。
// 规则：后端 message 已是中文（403 FORBIDDEN / VALIDATION 等）→ 原样展示；
//       英文 message 按 code 映射（ACTIVE_SPRINT_EXISTS / NOT_FOUND / CONFLICT …）；
//       无映射按 HTTP 状态兜底；网络错误 → 网络提示；其余回退 message / 未知错误。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../../src/api/client.ts'
import { apiErrorMessage } from '../../src/api/errors.ts'
import zh from '../../src/i18n/zh.ts'
import en from '../../src/i18n/en.ts'

test('errors: ACTIVE_SPRINT_EXISTS 英文 message → 中文映射', () => {
  const err = new ApiError(409, 'ACTIVE_SPRINT_EXISTS', 'project already has an active sprint: 迭代 1')
  const msg = apiErrorMessage(err, zh)
  assert.equal(msg, zh.apiErrors.ACTIVE_SPRINT_EXISTS)
  assert.doesNotMatch(msg, /project already/)
})

test('errors: NOT_FOUND "resource not found" → 中文', () => {
  const msg = apiErrorMessage(new ApiError(404, 'NOT_FOUND', 'resource not found'), zh)
  assert.equal(msg, zh.apiErrors.NOT_FOUND)
})

test('errors: 403 FORBIDDEN 后端中文 message 原样展示', () => {
  const msg = apiErrorMessage(new ApiError(403, 'FORBIDDEN', '仅管理员可以删除项目'), zh)
  assert.equal(msg, '仅管理员可以删除项目')
})

test('errors: VALIDATION 后端中文 message 原样展示', () => {
  const msg = apiErrorMessage(new ApiError(400, 'VALIDATION', '显示名不能为空'), zh)
  assert.equal(msg, '显示名不能为空')
})

test('errors: 未知 code + 英文 message 按 HTTP 状态兜底（5xx）', () => {
  const msg = apiErrorMessage(new ApiError(500, 'UNKNOWN', 'Internal Server Error'), zh)
  assert.equal(msg, zh.apiErrors.SERVER_ERROR)
})

test('errors: 未知 code + 4xx 英文 message 回退为原文（不吞信息）', () => {
  const msg = apiErrorMessage(new ApiError(422, 'SOMETHING_ELSE', 'weird thing'), zh)
  assert.equal(msg, 'weird thing')
})

test('errors: fetch 网络错误（TypeError）→ 网络提示', () => {
  const msg = apiErrorMessage(new TypeError('Failed to fetch'), zh)
  assert.equal(msg, zh.apiErrors.NETWORK)
})

test('errors: 非 Error 值 → 未知错误', () => {
  assert.equal(apiErrorMessage(undefined, zh), zh.unknownError)
  assert.equal(apiErrorMessage('x', zh), zh.unknownError)
})

test('errors: 英文 locale 同样按 code 映射', () => {
  const err = new ApiError(409, 'ACTIVE_SPRINT_EXISTS', 'project already has an active sprint: S1')
  assert.equal(apiErrorMessage(err, en), en.apiErrors.ACTIVE_SPRINT_EXISTS)
})

// 审查 2026-09-25 易用性 #4：英文界面不能把后端中文 message 原样直出，先按 code 查 en.apiErrors
test('errors: 中文 message + en locale → 按 code 映射为英文', () => {
  const msg = apiErrorMessage(new ApiError(403, 'FORBIDDEN', '仅管理员可操作'), en)
  assert.equal(msg, en.apiErrors.FORBIDDEN)
  assert.doesNotMatch(msg, /[\u3400-\u9fff]/)
})

test('errors: VALIDATION 中文 message + en locale → en.apiErrors.VALIDATION', () => {
  const msg = apiErrorMessage(new ApiError(400, 'VALIDATION', '密码至少 8 位'), en)
  assert.equal(msg, en.apiErrors.VALIDATION)
})

test('errors: 中文 message + en locale + 无映射 code → 回退后端原文（不吞信息）', () => {
  const msg = apiErrorMessage(new ApiError(409, 'LAST_ADMIN', '至少保留一名管理员'), en)
  assert.equal(msg, '至少保留一名管理员')
})

test('errors: 中文 message + en locale + 无映射 code + 5xx → 英文服务器错误', () => {
  const msg = apiErrorMessage(new ApiError(500, 'WHATEVER', '服务器开小差了'), en)
  assert.equal(msg, en.apiErrors.SERVER_ERROR)
})

test('errors: zh locale 下中文 message 仍优先于 code 映射（保留后端更具体的说明）', () => {
  const msg = apiErrorMessage(new ApiError(403, 'FORBIDDEN', '仅管理员可以删除项目'), zh)
  assert.equal(msg, '仅管理员可以删除项目')
})
