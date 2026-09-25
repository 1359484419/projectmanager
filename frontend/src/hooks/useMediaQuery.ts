// 响应式断点 hook：≤768px 视为移动端（侧栏抽屉、看板单列、规划页上下堆叠、顶栏隐藏次要图标）。
import { useSyncExternalStore } from 'react'

export const MOBILE_QUERY = '(max-width: 768px)'

function subscribe(query: string, cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(query)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
