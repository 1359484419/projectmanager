const ACCESS_TOKEN_KEY = 'accessToken'
const REFRESH_TOKEN_KEY = 'refreshToken'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/** 从 JWT 的 payload.sub 解析用户 id；结构非法 / sub 非正整数返回 null */
export function userIdFromToken(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4 !== 0) b64 += '='
    const payload = JSON.parse(atob(b64)) as { sub?: unknown }
    const n = Number(payload.sub)
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** 当前登录用户 id（accessToken payload.sub）；未登录或解析失败返回 null */
export function currentUserId(): number | null {
  const token = getAccessToken()
  return token ? userIdFromToken(token) : null
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** 乐观锁并发冲突统一提示文案（F9） */
export const CONFLICT_TOAST = '该任务刚被他人修改，已刷新最新数据，请重试'

/** 乐观锁并发冲突：HTTP 409 且 code=CONFLICT（区别于成员移出等其他 409 语义） */
export function isConflictError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.code === 'CONFLICT'
}

// 并发 401 时共享同一次 refresh 请求
let refreshPromise: Promise<boolean> | null = null

export async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) return false
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!res.ok) {
          clearTokens()
          return false
        }
        const data = await res.json()
        setTokens(data.accessToken, data.refreshToken)
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = getAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(path, { ...init, headers })
}

/** 登录页地址（带 returnTo=当前站内路径），路由守卫 RequireAuth 与 401 兜底共用 */
export function loginPathWithReturnTo(pathname: string, search: string): string {
  return `/login?returnTo=${encodeURIComponent(pathname + search)}`
}

/** 会话失效兜底：清 token 并整页跳转 /login?returnTo=<当前页>，避免用户卡死在报错页面 */
function redirectToLogin(): void {
  clearTokens()
  if (window.location.pathname === '/login') return
  window.location.assign(loginPathWithReturnTo(window.location.pathname, window.location.search))
}

/** /api/auth/**（登录/注册/接受邀请/refresh）的 401 是业务结果（如密码错），不能触发跳登录 */
function isAuthPath(path: string): boolean {
  return path.startsWith('/api/auth/')
}

/**
 * 401 统一处理：有 refreshToken 先刷新再重发一次；刷新失败或从未登录（无 refreshToken）
 * 都跳登录页——后者是「未登录直接打开租户深链」的场景，以前只抛错导致页面停在骨架屏。
 * 返回重发后的响应；需要跳登录时抛 SESSION_EXPIRED。
 */
async function handle401(path: string, init: RequestInit | undefined, res: Response): Promise<Response> {
  if (res.status !== 401 || isAuthPath(path)) return res
  if (getRefreshToken() && (await tryRefresh())) {
    return rawFetch(path, init)
  }
  redirectToLogin()
  throw new ApiError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录')
}

/**
 * 原始 Response 版的 api()：同样自动带 token、401 时 refresh 后重发同一请求、
 * refresh 失败跳 /login。不解析响应体——给 SSE 流式接口（助手面板）用，
 * 调用方自己判断 res.ok 与读取 body。
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return handle401(path, init, await rawFetch(path, init))
}

/**
 * fetch 封装：自动带 Authorization: Bearer <accessToken>；
 * 401 时尝试 refresh 后重试一次；refresh 也失败（refreshToken 过期/吊销）或从未登录则
 * 清 token 并跳转 /login（带 returnTo）。返回解析后的 JSON（204 返回 undefined）。
 */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await handle401(path, init, await rawFetch(path, init))
  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = res.statusText
    try {
      const body = await res.json()
      code = body.code ?? code
      message = body.message ?? message
    } catch {
      // 非 JSON 错误体，保留默认
    }
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  // 后端 void 写接口返回 200 空 body（如 DELETE 成员），res.json() 对空串会抛
  // SyntaxError 把成功误判为失败，这里按文本解析、空体返回 undefined
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
