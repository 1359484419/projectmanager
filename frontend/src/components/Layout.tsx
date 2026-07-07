import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { clearTokens } from '../api/client'

const NAV_ITEMS: { label: string; path: string }[] = [
  { label: 'Dashboard', path: 'dashboard' },
  { label: 'Backlog', path: 'backlog' },
  { label: 'Board', path: 'board' },
  { label: 'All Sprints', path: 'sprints' },
  { label: 'Planning', path: 'planning' },
  { label: 'Reports', path: 'reports' },
  { label: 'Roadmap', path: 'roadmap' },
  { label: 'Admin', path: 'admin' },
  { label: 'Settings', path: 'settings' },
]

/** 租户内布局：左侧固定导航 + 右侧路由内容（<Outlet/>） */
export default function Layout() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()

  function handleLogout() {
    clearTokens()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100svh', textAlign: 'left' }}>
      <aside
        style={{
          width: 208,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          padding: '16px 12px',
          boxSizing: 'border-box',
        }}
      >
        <Link
          to={`/t/${slug}/dashboard`}
          style={{
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--text-h)',
            textDecoration: 'none',
            padding: '4px 10px',
            marginBottom: 4,
          }}
        >
          Mini Jira
        </Link>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text)',
            padding: '0 10px',
            marginBottom: 16,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={slug}
        >
          租户：{slug}
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => ({
                display: 'block',
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                textDecoration: 'none',
                color: isActive ? 'var(--accent)' : 'var(--text)',
                background: isActive ? 'var(--accent-bg)' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <Link
            to="/tenants"
            style={{ fontSize: 13, color: 'var(--text)', textDecoration: 'none', padding: '2px 10px' }}
          >
            切换租户
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: 'none',
              background: 'none',
              textAlign: 'left',
              fontSize: 13,
              color: 'var(--text)',
              cursor: 'pointer',
              padding: '2px 10px',
            }}
          >
            退出登录
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, padding: 24, boxSizing: 'border-box' }}>
        <Outlet />
      </main>
    </div>
  )
}
