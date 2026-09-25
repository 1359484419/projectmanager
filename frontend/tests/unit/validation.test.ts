// 单测：注册 / 接受邀请表单受控校验（审查 P1「注册接口只校验非空 + 浏览器原生英文气泡」）。
// 规则与后端约束对齐：邮箱格式、密码 ≥ 8、团队标识 3-32 位小写字母/数字/连字符、两次密码一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidEmail,
  isValidPassword,
  isValidSlug,
  validateAcceptInvite,
  validateRegister,
} from '../../src/utils/validation.ts'

test('validation: 邮箱格式', () => {
  assert.equal(isValidEmail('you@acme.io'), true)
  assert.equal(isValidEmail('a.b+c@sub.example.co'), true)
  assert.equal(isValidEmail('notanemail'), false)
  assert.equal(isValidEmail('a@'), false)
  assert.equal(isValidEmail('@x.com'), false)
  assert.equal(isValidEmail('a@b'), false)
  assert.equal(isValidEmail(' you@acme.io'), false)
})

test('validation: 密码至少 8 位', () => {
  assert.equal(isValidPassword('1'), false)
  assert.equal(isValidPassword('1234567'), false)
  assert.equal(isValidPassword('12345678'), true)
})

test('validation: 团队标识 3-32 位小写字母、数字或连字符', () => {
  assert.equal(isValidSlug('acme'), true)
  assert.equal(isValidSlug('a-1'), true)
  assert.equal(isValidSlug('ab'), false)
  assert.equal(isValidSlug('Acme'), false)
  assert.equal(isValidSlug('a_b'), false)
  assert.equal(isValidSlug('a'.repeat(33)), false)
  assert.equal(isValidSlug('a'.repeat(32)), true)
})

test('validation: 注册表单逐字段错误键', () => {
  const errs = validateRegister({
    displayName: '',
    tenantName: '',
    tenantSlug: 'A',
    email: 'notanemail',
    password: '1',
    confirmPassword: '2',
  })
  assert.deepEqual(errs, {
    displayName: 'required',
    tenantName: 'required',
    tenantSlug: 'slug',
    email: 'email',
    password: 'password',
    confirmPassword: 'mismatch',
  })
})

test('validation: 注册表单合法时无错误', () => {
  const errs = validateRegister({
    displayName: '张三',
    tenantName: '卧龙科技',
    tenantSlug: 'wolong',
    email: 'zs@wolong.io',
    password: 'secret123',
    confirmPassword: 'secret123',
  })
  assert.deepEqual(errs, {})
})

test('validation: 接受邀请表单（令牌必填、邮箱、密码 ≥ 8；显示名可空）', () => {
  assert.deepEqual(validateAcceptInvite({ token: '', email: 'x', password: '123' }), {
    token: 'required',
    email: 'email',
    password: 'password',
  })
  assert.deepEqual(validateAcceptInvite({ token: 'tok', email: 'a@b.io', password: 'secret123' }), {})
})
