// 单测：会话守卫（审查 P1「未登录深链停在永久骨架屏」）。
// 1) loginPathWithReturnTo：无 token 时路由守卫要跳的 /login?returnTo=…（只带站内路径）；
// 2) api()：401 且没有 refreshToken（从未登录）也要跳登录，而不是只抛错；
// 3) /api/auth/** 的 401（如密码错）不能触发跳转，登录页要自己展示错误。
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
const assigned: string[] = []
;(globalThis as Record<string, unknown>).window = {
  location: { pathname: '/t/acme/board', search: '?project=PM', assign: (u: string) => assigned.push(u) },
}

const { api, apiFetch, ApiError, loginPathWithReturnTo } = await import('../../src/api/client.ts')

let realFetch: typeof fetch
beforeEach(() => {
  realFetch = globalThis.fetch
  store.clear()
  assigned.length = 0
})
afterEach(() => {
  globalThis.fetch = realFetch
})

test('loginPathWithReturnTo: 带上当前站内路径', () => {
  assert.equal(
    loginPathWithReturnTo('/t/acme/board', '?project=PM'),
    '/login?returnTo=%2Ft%2Facme%2Fboard%3Fproject%3DPM',
  )
  assert.equal(loginPathWithReturnTo('/tenants', ''), '/login?returnTo=%2Ftenants')
})

test('api: 401 且无 refreshToken → 跳 /login?returnTo 并抛 SESSION_EXPIRED', async () => {
  globalThis.fetch = async () => new Response('{"code":"UNAUTHORIZED","message":"x"}', { status: 401 })
  await assert.rejects(api('/api/t/acme/notifications'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.code, 'SESSION_EXPIRED')
    return true
  })
  assert.deepEqual(assigned, ['/login?returnTo=%2Ft%2Facme%2Fboard%3Fproject%3DPM'])
})

test('apiFetch: 401 且无 refreshToken 同样跳登录', async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 })
  await assert.rejects(apiFetch('/api/t/acme/assistant/messages'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.code, 'SESSION_EXPIRED')
    return true
  })
  assert.equal(assigned.length, 1)
})

test('api: /api/auth/login 的 401（密码错）不跳转，原样抛 BAD_CREDENTIALS', async () => {
  globalThis.fetch = async () =>
    new Response('{"code":"BAD_CREDENTIALS","message":"invalid email or password"}', { status: 401 })
  await assert.rejects(api('/api/auth/login', { method: 'POST', body: '{}' }), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.code, 'BAD_CREDENTIALS')
    return true
  })
  assert.deepEqual(assigned, [])
})

test('api: 401 且有 refreshToken 但 refresh 失败 → 清 token 并跳登录', async () => {
  store.set('accessToken', 'a.b.c')
  store.set('refreshToken', 'r')
  globalThis.fetch = async () => new Response(null, { status: 401 })
  await assert.rejects(api('/api/t/acme/projects'))
  assert.equal(store.get('accessToken'), undefined)
  assert.equal(assigned.length, 1)
})
