// 注册 / 接受邀请表单的受控校验（与后端 @Email / @Size(min=8) / slug @Pattern 对齐）。
// 页面用错误键查 i18n 文案做中文行内提示，不依赖浏览器原生英文气泡。

export const PASSWORD_MIN = 8
export const SLUG_PATTERN = /^[a-z0-9-]{3,32}$/
// 宽松但排除明显非法：本地部分@域名.顶级域（≥2 位），不允许空白
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(v: string): boolean {
  return EMAIL_PATTERN.test(v)
}

export function isValidPassword(v: string): boolean {
  return v.length >= PASSWORD_MIN
}

export function isValidSlug(v: string): boolean {
  return SLUG_PATTERN.test(v)
}

export type FieldErrorKey = 'required' | 'email' | 'password' | 'slug' | 'mismatch'

export interface RegisterInput {
  displayName: string
  tenantName: string
  tenantSlug: string
  email: string
  password: string
  confirmPassword: string
}

export type RegisterErrors = Partial<Record<keyof RegisterInput, FieldErrorKey>>

export function validateRegister(v: RegisterInput): RegisterErrors {
  const errs: RegisterErrors = {}
  if (!v.displayName.trim()) errs.displayName = 'required'
  if (!v.tenantName.trim()) errs.tenantName = 'required'
  if (!isValidSlug(v.tenantSlug)) errs.tenantSlug = 'slug'
  if (!isValidEmail(v.email)) errs.email = 'email'
  if (!isValidPassword(v.password)) errs.password = 'password'
  if (v.confirmPassword !== v.password) errs.confirmPassword = 'mismatch'
  return errs
}

export interface AcceptInviteInput {
  token: string
  email: string
  password: string
}

export type AcceptInviteErrors = Partial<Record<keyof AcceptInviteInput, FieldErrorKey>>

export function validateAcceptInvite(v: AcceptInviteInput): AcceptInviteErrors {
  const errs: AcceptInviteErrors = {}
  if (!v.token.trim()) errs.token = 'required'
  if (!isValidEmail(v.email)) errs.email = 'email'
  if (!isValidPassword(v.password)) errs.password = 'password'
  return errs
}
