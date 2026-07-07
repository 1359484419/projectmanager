// 全站共享的「当前选中项目」状态：按租户 slug 持久化到 localStorage（key pm-project:<slug>）。
// 顶栏项目切换器与各页面（Dashboard/Backlog/Board/AllSprints/Planning/Reports/Roadmap）联动。
// 模式同 assigneeFilter.ts：模块级 store + useSyncExternalStore。
import { useSyncExternalStore } from 'react'

const KEY_PREFIX = 'pm-project:'

const cache = new Map<string, string | null>()
const listeners = new Set<() => void>()

function read(slug: string): string | null {
  if (!cache.has(slug)) {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(KEY_PREFIX + slug)
    } catch {
      // localStorage 不可用时无持久化，仅会话内联动
    }
    cache.set(slug, raw)
  }
  return cache.get(slug) ?? null
}

/** 切换选中项目（按租户记忆），全站订阅方即时联动 */
export function setSelectedProjectKey(slug: string, key: string) {
  cache.set(slug, key)
  try {
    localStorage.setItem(KEY_PREFIX + slug, key)
  } catch {
    // 持久化失败不阻断本会话内联动
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 当前租户记忆的项目 key（未选过 / 不可用时为 null，由 resolveProjectKey 兜底） */
export function useSelectedProjectKey(slug: string): string | null {
  return useSyncExternalStore(subscribe, () => read(slug))
}

/**
 * 决定页面实际使用的项目 key：
 * URL ?project=（深链优先）→ 记忆的选中项目 → 第一个项目。
 * 无效 key（项目被删/换租户残留）自动回退，projects 未加载时返回 ''。
 */
export function resolveProjectKey(
  urlKey: string | null,
  storedKey: string | null,
  projects: readonly { key: string }[] | undefined,
): string {
  const keys = new Set((projects ?? []).map((p) => p.key))
  if (urlKey && keys.has(urlKey)) return urlKey
  if (storedKey && keys.has(storedKey)) return storedKey
  return projects?.[0]?.key ?? ''
}
