// 路由级鉴权守卫：没有 accessToken（从未登录 / 已登出）直接送去 /login?returnTo=当前页，
// 而不是渲染外壳后让每个接口 401、页面停在骨架屏。token 过期由 api() 的 refresh/跳转兜底。
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getAccessToken, loginPathWithReturnTo } from '../api/client'

export default function RequireAuth() {
  const location = useLocation()
  if (!getAccessToken()) {
    return <Navigate to={loginPathWithReturnTo(location.pathname, location.search)} replace />
  }
  return <Outlet />
}
