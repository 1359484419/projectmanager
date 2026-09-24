// 助手面板的状态与副作用：线程管理、发送消息 / 提交决策（SSE 流）、
// TOKEN_EXPIRED 刷新后重发、写入成功后失效 TanStack Query 缓存。
// 纯 reducer 在 reducer.ts，这里只做编排。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch, tryRefresh } from '../api/client'
import { useT } from '../i18n'
import { readSse } from './sse'
import { applyDecision, expiredPendingCards, mergePendingCards, pendingCards, reduce, shouldInvalidate, type ChatItem } from './reducer'
import type { Card, Decision, Risk, SseEvent, ThreadSnapshot } from './types'

export { reduce }
export type { ChatItem }

/** 连接层失败（尚未执行任何写操作）才允许「重试」 */
export const RETRYABLE_CODES = new Set(['ASSISTANT_UNAVAILABLE', 'LLM_UNAVAILABLE', 'NETWORK'])

const THREAD_KEY_PREFIX = 'pm-assistant-thread:'

function readThread(slug: string): string | null {
  try {
    return sessionStorage.getItem(THREAD_KEY_PREFIX + slug)
  } catch {
    return null
  }
}

function writeThread(slug: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(THREAD_KEY_PREFIX + slug, id)
    else sessionStorage.removeItem(THREAD_KEY_PREFIX + slug)
  } catch {
    // sessionStorage 不可用时只在内存里记
  }
}

export interface Assistant {
  items: ChatItem[]
  send(text: string): Promise<void>
  decide(d: Decision): Promise<void>
  /** 重发上一条用户消息（仅错误卡可重试时用） */
  retry(): Promise<void>
  pending: Card[]
  busy: boolean
  reset(): void
  /** 面板打开时调用一次：有上次线程则恢复历史与挂起卡 */
  restore(): Promise<void>
}

export function useAssistant(slug: string, projectKey: string | null): Assistant {
  const t = useT()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  /** 确认卡过期判定用的时钟：有未决策卡时每秒走一次，过期即解除输入框阻塞 */
  const [now, setNow] = useState(() => Date.now())
  const itemsRef = useRef<ChatItem[]>([])
  const threadRef = useRef<string | null>(readThread(slug))
  const decisionsRef = useRef<Map<string, Decision>>(new Map())
  /** 本轮挂起的确认卡 callId（服务端一次发出本轮全部卡；按顺序），全部决策后一并 resume */
  const batchRef = useRef<string[]>([])
  /** callId → 工具等级（tool_start 带），tool_result 时据此决定是否失效查询缓存 */
  const riskRef = useRef<Map<string, Risk>>(new Map())
  const lastTextRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pageRef = useRef(location.pathname)
  pageRef.current = location.pathname

  const update = useCallback((fn: (prev: ChatItem[]) => ChatItem[]) => {
    itemsRef.current = fn(itemsRef.current)
    setItems(itemsRef.current)
  }, [])

  // 换租户：线程与消息都不复用
  useEffect(() => {
    threadRef.current = readThread(slug)
    itemsRef.current = []
    setItems([])
    decisionsRef.current.clear()
    batchRef.current = []
  }, [slug])

  useEffect(() => () => abortRef.current?.abort(), [])

  const pushError = useCallback(
    (code: string, message: string) => update((prev) => reduce(prev, { type: 'error', code, message })),
    [update],
  )

  const handleEvent = useCallback(
    (ev: SseEvent) => {
      update((prev) => reduce(prev, ev))
      if (ev.type === 'confirm') {
        // 同 callId 再次到达（409 重出卡）：旧决策作废，需要重新确认
        decisionsRef.current.delete(ev.callId)
        if (!batchRef.current.includes(ev.callId)) batchRef.current.push(ev.callId)
      }
      if (ev.type === 'tool_start') riskRef.current.set(ev.callId, ev.risk)
      if (shouldInvalidate(riskRef.current, ev)) {
        // 写入成功 → 看板/待办等所有该租户查询即时刷新（只读工具不触发）
        queryClient.invalidateQueries({ queryKey: [slug] })
      }
    },
    [queryClient, slug, update],
  )

  /** 服务端告知的挂起卡（409 THREAD_PENDING / GET 恢复）→ 补进消息流并登记到本轮批次 */
  const adoptPending = useCallback(
    (cards: Card[]) => {
      update((prev) => mergePendingCards(prev, cards))
      for (const c of cards) if (!batchRef.current.includes(c.callId)) batchRef.current.push(c.callId)
    },
    [update],
  )

  const ensureThread = useCallback(async (): Promise<string> => {
    if (threadRef.current) return threadRef.current
    const res = await apiFetch(`/api/t/${slug}/assistant/threads`, { method: 'POST', body: '{}' })
    if (!res.ok) throw (await toApiError(res)).error
    const data = (await res.json()) as { threadId: string }
    threadRef.current = data.threadId
    writeThread(slug, data.threadId)
    return data.threadId
  }, [slug])

  /** 发起一次 SSE 请求并消费事件；TOKEN_EXPIRED → refresh 后重发同一请求（只重发一次） */
  const run = useCallback(
    async (request: (signal: AbortSignal) => Promise<Response>) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setBusy(true)
      try {
        let retriedAuth = false
        while (true) {
          const res = await request(ac.signal)
          if (!res.ok) {
            const { error: err, body } = await toApiError(res)
            if (err.status === 503 || err.code === 'ASSISTANT_UNAVAILABLE') {
              pushError('ASSISTANT_UNAVAILABLE', t.assistant.unavailable)
            } else if (err.status === 409 && err.code === 'THREAD_PENDING') {
              // 线程还有未决策的卡（如另一个标签页发起的）：把服务端的挂起卡接回来，用户决策后仍可提交
              const cards = Array.isArray(body?.pendingCards) ? (body.pendingCards as Card[]) : []
              if (cards.length > 0) adoptPending(cards)
              pushError(err.code, err.message)
            } else if (err.status === 404 && threadRef.current) {
              // 线程已过期/被清理：丢掉本地线程，让用户重发即可
              threadRef.current = null
              writeThread(slug, null)
              pushError(err.code, t.assistant.restoreFailed)
            } else {
              pushError(err.code, t.assistant.requestFailed(err.message))
            }
            return
          }
          let tokenExpired = false
          for await (const ev of readSse(res)) {
            if (ev.type === 'error' && ev.code === 'TOKEN_EXPIRED') {
              if (!retriedAuth) {
                tokenExpired = true
                break
              }
              // 刷新后重发仍然 401：不会再自动重试，文案不能再说「正在自动刷新后重试」
              pushError('SESSION_EXPIRED', t.assistant.sessionExpired)
              continue
            }
            handleEvent(ev)
          }
          if (!tokenExpired) return
          retriedAuth = true
          if (!(await tryRefresh())) {
            pushError('SESSION_EXPIRED', t.assistant.sessionExpired)
            return
          }
        }
      } catch (e) {
        if (ac.signal.aborted) return
        if (e instanceof ApiError) pushError(e.code, e.message)
        else pushError('NETWORK', t.assistant.networkError)
      } finally {
        if (abortRef.current === ac) setBusy(false)
      }
    },
    [adoptPending, handleEvent, pushError, slug, t],
  )

  /** send 内先取消过期卡要用 decide，而 decide 定义在后面：经 ref 引用避免循环依赖 */
  const decideRef = useRef<(d: Decision) => Promise<void>>(async () => {})

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      // 有未过期的确认卡挂起时不发新消息（服务端会 409）：不清空批次，卡片仍可决策提交
      if (pendingCards(itemsRef.current).length > 0) return
      // 只剩过期卡：先替用户全部「取消」（服务端回 CARD_EXPIRED 收尾本轮），线程解除挂起后再发这句话
      for (const c of expiredPendingCards(itemsRef.current)) {
        const reject: Decision = { callId: c.callId, type: 'reject' }
        if (threadRef.current && batchRef.current.includes(c.callId)) await decideRef.current(reject)
        else update((prev) => applyDecision(prev, reject))   // 孤儿卡（线程已失效/重置）：本地标记取消即可
      }
      // 取消过程中服务端又出了新卡（不太可能，但协议允许）：先处理它们
      if (pendingCards(itemsRef.current).length > 0) return
      lastTextRef.current = trimmed
      update((prev) => [...prev, { kind: 'user', text: trimmed }])
      await run(async (signal) => {
        const id = await ensureThread()
        const qs = new URLSearchParams()
        if (projectKey) qs.set('project', projectKey)
        qs.set('page', pageRef.current)
        return apiFetch(`/api/t/${slug}/assistant/threads/${id}/messages?${qs}`, {
          method: 'POST',
          body: JSON.stringify({ text: trimmed }),
          signal,
        })
      })
    },
    [ensureThread, projectKey, run, slug, update],
  )

  const decide = useCallback(
    async (d: Decision) => {
      // 先校验再标记：不属于本轮批次的卡（已提交过 / 会话已重置）不接受，避免 UI 显示"已确认"却没发请求
      if (!batchRef.current.includes(d.callId) || !threadRef.current) return
      decisionsRef.current.set(d.callId, d)
      update((prev) => applyDecision(prev, d))
      // 全部到齐才提交：任何一张未决策前不执行任何写操作
      const remaining = batchRef.current.filter((cid) => !decisionsRef.current.has(cid))
      if (remaining.length > 0) return
      const decisions = batchRef.current
        .map((cid) => decisionsRef.current.get(cid))
        .filter((x): x is Decision => x != null)
      decisionsRef.current.clear()
      batchRef.current = []
      const id = threadRef.current
      if (decisions.length === 0) return
      await run((signal) => {
        const qs = new URLSearchParams()
        if (projectKey) qs.set('project', projectKey)
        qs.set('page', pageRef.current)
        return apiFetch(`/api/t/${slug}/assistant/threads/${id}/resume?${qs}`, {
          method: 'POST',
          body: JSON.stringify({ decisions }),
          signal,
        })
      })
    },
    [projectKey, run, slug, update],
  )
  decideRef.current = decide

  const retry = useCallback(async () => {
    const text = lastTextRef.current
    if (!text) return
    // 去掉尾部的错误卡再重发，避免面板里堆一串同样的错误
    update((prev) => (prev[prev.length - 1]?.kind === 'error' ? prev.slice(0, -1) : prev))
    await send(text)
  }, [send, update])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    threadRef.current = null
    writeThread(slug, null)
    decisionsRef.current.clear()
    batchRef.current = []
    riskRef.current.clear()
    lastTextRef.current = null
    update(() => [])
  }, [slug, update])

  const restore = useCallback(async () => {
    const id = threadRef.current
    if (!id || itemsRef.current.length > 0) return
    try {
      const res = await apiFetch(`/api/t/${slug}/assistant/threads/${id}`)
      if (!res.ok) {
        threadRef.current = null
        writeThread(slug, null)
        return
      }
      const snap = (await res.json()) as Partial<ThreadSnapshot>
      const restored: ChatItem[] = []
      for (const m of snap.messages ?? []) {
        if ((m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text) {
          restored.push({ kind: m.role, text: m.text })
        }
      }
      batchRef.current = []
      decisionsRef.current.clear()
      update(() => restored)
      adoptPending(snap.pendingCards ?? [])
    } catch {
      // 恢复失败不影响新会话
    }
  }, [adoptPending, slug, update])

  const pending = useMemo(() => pendingCards(items, now), [items, now])

  // 有未决策的卡时每秒重算一次过期状态（ConfirmCard 自己的秒表只重绘卡片，不影响这里的 blocked）
  const hasUndecided = items.some((it) => it.kind === 'confirm' && !it.decided)
  useEffect(() => {
    if (!hasUndecided) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasUndecided])

  return { items, send, decide, retry, pending, busy, reset, restore }
}

async function toApiError(res: Response): Promise<{ error: ApiError; body: Record<string, unknown> | null }> {
  let code = 'UNKNOWN'
  let message = res.statusText
  let body: Record<string, unknown> | null = null
  try {
    body = (await res.json()) as Record<string, unknown>
    if (typeof body.code === 'string') code = body.code
    if (typeof body.message === 'string') message = body.message
  } catch {
    // 非 JSON 错误体
  }
  return { error: new ApiError(res.status, code, message), body }
}
