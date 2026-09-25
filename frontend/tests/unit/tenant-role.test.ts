// 单测：角色可见性与「我是谁」（审查 P1「成员看到完整管理员面板」+ P2「头像永远显示我」）。
// 前端用 /api/me/tenants 的 role 判定管理写控件；显示名取自成员列表里 userId == 当前用户的那条。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canManageTenant, findMe } from '../../src/state/tenantRole.ts'

test('tenantRole: 只有 ADMIN 可管理', () => {
  assert.equal(canManageTenant('ADMIN'), true)
  assert.equal(canManageTenant('MEMBER'), false)
  // 角色未知（列表未加载）时 fail-closed：不显示写控件
  assert.equal(canManageTenant(undefined), false)
  assert.equal(canManageTenant(null), false)
})

test('findMe: 按当前用户 id 在成员列表里找到显示名与邮箱', () => {
  const members = [
    { userId: 1, displayName: '张三', email: 'zs@x.io', role: 'ADMIN' as const },
    { userId: 2, displayName: '新用户小王', email: 'wang@x.io', role: 'MEMBER' as const },
  ]
  assert.deepEqual(findMe(members, 2), { name: '新用户小王', email: 'wang@x.io' })
  assert.equal(findMe(members, 3), null)
  assert.equal(findMe(undefined, 1), null)
  assert.equal(findMe(members, null), null)
})
