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

async function tryRefresh(): Promise<boolean> {
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

/** 会话失效兜底：清 token 并整页跳转 /login?returnTo=<当前页>，避免用户卡死在报错页面 */
function redirectToLogin(): void {
  clearTokens()
  if (window.location.pathname === '/login') return
  const returnTo = window.location.pathname + window.location.search
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`)
}

/**
 * fetch 封装：自动带 Authorization: Bearer <accessToken>；
 * 401 时尝试 refresh 后重试一次；refresh 也失败（refreshToken 过期/吊销）则
 * 清 token 并跳转 /login（带 returnTo）。返回解析后的 JSON（204 返回 undefined）。
 */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let res = await rawFetch(path, init)
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      res = await rawFetch(path, init)
    } else {
      redirectToLogin()
      throw new ApiError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录')
    }
  }
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
