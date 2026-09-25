// 租户内角色 / 当前用户身份的纯函数（Layout、TenantAdmin、空态 CTA 共用）。
// 角色来自 /api/me/tenants（MyTenant.role）；显示名来自成员列表（后端 JWT 只有 sub，拿不到名字）。
import type { Member, Role } from '../api/types'

/** 只有 ADMIN 显示管理写控件；角色未知（列表未加载）时 fail-closed */
export function canManageTenant(role: Role | null | undefined): boolean {
  return role === 'ADMIN'
}

/** 在成员列表里找当前用户，用于顶栏/侧栏头像与显示名 */
export function findMe(
  members: readonly Member[] | undefined,
  userId: number | null,
): { name: string; email: string } | null {
  if (!members || userId == null) return null
  const me = members.find((m) => m.userId === userId)
  return me ? { name: me.displayName, email: me.email } : null
}
