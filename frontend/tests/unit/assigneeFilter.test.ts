// 单测：负责人筛选核心逻辑（纯函数，node --test 直跑，无框架依赖）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchesAssignee,
  parseAssigneeFilter,
  serializeAssigneeFilter,
} from '../../src/state/assigneeFilterCore.ts'
import { userIdFromToken } from '../../src/api/client.ts'

// ---------- parseAssigneeFilter ----------

test('parse: 缺省（null）为 me', () => {
  assert.equal(parseAssigneeFilter(null), 'me')
})

test('parse: me / all 原样', () => {
  assert.equal(parseAssigneeFilter('me'), 'me')
  assert.equal(parseAssigneeFilter('all'), 'all')
})

test('parse: 数字字符串为 userId', () => {
  assert.equal(parseAssigneeFilter('42'), 42)
})

test('parse: 非法值回退 me', () => {
  assert.equal(parseAssigneeFilter('garbage'), 'me')
  assert.equal(parseAssigneeFilter('-3'), 'me')
  assert.equal(parseAssigneeFilter('1.5'), 'me')
  assert.equal(parseAssigneeFilter(''), 'me')
})

// ---------- serializeAssigneeFilter（round-trip） ----------

test('serialize: round-trip', () => {
  for (const v of ['me', 'all', 7] as const) {
    assert.equal(parseAssigneeFilter(serializeAssigneeFilter(v)), v)
  }
})

// ---------- matchesAssignee ----------

test('match: all 全放行', () => {
  assert.equal(matchesAssignee(1, 'all', 5), true)
  assert.equal(matchesAssignee(null, 'all', 5), true)
  assert.equal(matchesAssignee(undefined, 'all', null), true)
})

test('match: me 视图含自己与未指派，不含他人', () => {
  assert.equal(matchesAssignee(5, 'me', 5), true)
  assert.equal(matchesAssignee(null, 'me', 5), true) // 未指派也显示，避免新任务丢失感
  assert.equal(matchesAssignee(undefined, 'me', 5), true)
  assert.equal(matchesAssignee(7, 'me', 5), false)
})

test('match: me 视图在解析不出当前用户时仍显示未指派', () => {
  assert.equal(matchesAssignee(null, 'me', null), true)
  assert.equal(matchesAssignee(5, 'me', null), false)
})

test('match: 指定 userId 只看该人（不含未指派）', () => {
  assert.equal(matchesAssignee(7, 7, 5), true)
  assert.equal(matchesAssignee(5, 7, 5), false)
  assert.equal(matchesAssignee(null, 7, 5), false)
})

// ---------- userIdFromToken ----------

function fakeJwt(payload: object): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

test('jwt: 解析 sub 为数字 id', () => {
  assert.equal(userIdFromToken(fakeJwt({ sub: '42' })), 42)
  assert.equal(userIdFromToken(fakeJwt({ sub: 7 })), 7)
})

test('jwt: 非法 token / 非数字 sub 返回 null', () => {
  assert.equal(userIdFromToken('not-a-jwt'), null)
  assert.equal(userIdFromToken(''), null)
  assert.equal(userIdFromToken(fakeJwt({ sub: 'alice' })), null)
  assert.equal(userIdFromToken(fakeJwt({})), null)
  assert.equal(userIdFromToken('a.%%%.c'), null)
})
