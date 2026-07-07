// 单测：api() 对空响应体的健壮性。
// 后端 void 写接口（如 DELETE /members/{userId}）返回 200 空 body，
// res.json() 对空串抛 SyntaxError，会把「成功」误判为失败（onError 分支）。
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// client.ts 运行时依赖 localStorage（getAccessToken），node 环境先补一个内存版
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const { api, ApiError } = await import('../../src/api/client.ts')

let realFetch: typeof fetch
beforeEach(() => {
  realFetch = globalThis.fetch
})

function stubFetch(res: Response) {
  globalThis.fetch = async () => res
}

test('api: 200 空 body 返回 undefined 而非抛 SyntaxError', async () => {
  stubFetch(new Response(null, { status: 200 }))
  const out = await api('/api/x')
  assert.equal(out, undefined)
  globalThis.fetch = realFetch
})

test('api: 200 JSON body 正常解析', async () => {
  stubFetch(new Response('{"ok":true}', { status: 200 }))
  const out = await api<{ ok: boolean }>('/api/x')
  assert.deepEqual(out, { ok: true })
  globalThis.fetch = realFetch
})

test('api: 204 返回 undefined', async () => {
  stubFetch(new Response(null, { status: 204 }))
  assert.equal(await api('/api/x'), undefined)
  globalThis.fetch = realFetch
})

test('api: 非 2xx 抛 ApiError（带 code/message）', async () => {
  stubFetch(
    new Response('{"code":"CONFLICT","message":"任务已被他人修改"}', {
      status: 409,
      statusText: 'Conflict',
    }),
  )
  await assert.rejects(api('/api/x'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 409)
    assert.equal(err.code, 'CONFLICT')
    return true
  })
  globalThis.fetch = realFetch
})
