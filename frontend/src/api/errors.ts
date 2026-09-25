// 后端错误 → 用户可读文案的统一入口。
// 约定：后端 message 以中文为主（403 FORBIDDEN / VALIDATION / LAST_ADMIN …）。
//   中文界面：中文 message 直接展示（比 code 映射更具体）；仍是英文的历史错误按 code 映射。
//   英文界面：先按 code 查 t.apiErrors（否则「仅管理员可操作」会原样直出到英文界面），
//   未命中再回退后端 message（不吞信息）。
// 无映射时按 HTTP 状态兜底；fetch 层的网络错误（TypeError）给网络提示。
// 页面里所有 toast/行内错误一律 `t.xxxFailed(apiErrorMessage(err, t))`，不要直接拼 err.message。
import type { ApiError } from './client'
import type { Translations } from '../i18n'

/** 结构判定而非 instanceof：本模块被 node:test 直跑，避免运行时依赖 client.ts */
function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && typeof (err as ApiError).status === 'number' && typeof (err as ApiError).code === 'string'
}

/**
 * 判定后端 message 是否已是中文：CJK 字数多于拉丁字母数。
 * 只看"含不含中文"会把 "project already has an active sprint: 迭代 1" 误判为已本地化。
 */
function isLocalized(s: string): boolean {
  const cjk = (s.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (s.match(/[A-Za-z]/g) ?? []).length
  return cjk > 0 && cjk > latin
}

export function apiErrorMessage(err: unknown, t: Translations): string {
  if (isApiError(err)) {
    const msg = err.message?.trim() ?? ''
    // 只有界面本身是中文时，后端中文 message 才能原样直出；locale 与文案包绑定，不需要调用方额外传
    if (t.locale === 'zh' && isLocalized(msg)) return msg
    const mapped = (t.apiErrors as Record<string, string | undefined>)[err.code]
    if (mapped) return mapped
    if (err.status >= 500) return t.apiErrors.SERVER_ERROR
    return msg || t.unknownError
  }
  // fetch 抛 TypeError（断网 / DNS / CORS）
  if (err instanceof TypeError) return t.apiErrors.NETWORK
  if (err instanceof Error) return err.message || t.unknownError
  return t.unknownError
}
