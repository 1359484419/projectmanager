// 租户内布局：左侧可折叠侧边栏 + 顶栏 + 路由内容（<Outlet/>）
// 视觉真源：docs/design/mock/markup.html（SIDEBAR / topbar 节）
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clearTokens, getAccessToken } from '../api/client'
import { useBacklog, useDashboard, useMyTenants, useProjects, useSearchTasks } from '../api/hooks'
import CreateTaskDialog from './CreateTaskDialog'
import { resolveProjectKey, setSelectedProjectKey, useSelectedProjectKey } from '../state/selectedProject'
import type { SearchHit } from '../api/types'
import { Icon, type IconName } from './icons'
import { Avatar } from './TaskCard'
import StatusBadge from './StatusBadge'
import TypeIcon from './TypeIcon'
import TaskDrawer from './TaskDrawer'
import { useI18n, useT } from '../i18n'

/** 顶栏全局搜索：防抖 250ms，全租户按关键词搜标题/描述，点结果开任务抽屉，⌘K 聚焦 */
function GlobalSearch({ slug }: { slug: string }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [focused, setFocused] = useState(false)
  const [openHit, setOpenHit] = useState<SearchHit | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { data: hits, isFetching } = useSearchTasks(slug, debounced)
  const showDropdown = focused && debounced.length >= 1

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 30,
          padding: '0 10px',
          borderRadius: 7,
          border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--card)',
          color: 'var(--faint)',
          fontSize: 12.5,
          minWidth: 230,
          transition: 'border-color .12s',
        }}
      >
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          placeholder={t.searchPlaceholder}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--text)',
            fontSize: 12.5,
            minWidth: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '1px 5px',
          }}
        >
          ⌘K
        </span>
      </div>

      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            width: 420,
            maxHeight: 380,
            overflowY: 'auto',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 5,
            zIndex: 60,
          }}
        >
          {(hits ?? []).map((h) => (
            <div
              key={h.id}
              className="menu-item"
              // mousedown 先于 input blur，保证点击生效
              onMouseDown={(e) => {
                e.preventDefault()
                setOpenHit(h)
                setQ('')
                inputRef.current?.blur()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '7px 9px',
                borderRadius: 7,
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <TypeIcon type={h.type} size={14} />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: 'var(--faint)',
                  flex: 'none',
                }}
              >
                {h.displayKey}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {h.title}
                </span>
                {h.description && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: 'var(--dim)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {h.description}
                  </span>
                )}
              </span>
              <StatusBadge status={h.status} />
            </div>
          ))}
          {!isFetching && (hits ?? []).length === 0 && (
            <div style={{ padding: '14px 10px', fontSize: 12.5, color: 'var(--faint)', textAlign: 'center' }}>
              {t.noSearchResults(debounced)}
            </div>
          )}
          {isFetching && (hits ?? []).length === 0 && (
            <div style={{ padding: '14px 10px', fontSize: 12.5, color: 'var(--faint)', textAlign: 'center' }}>
              {t.searching}
            </div>
          )}
        </div>
      )}

      {openHit && (
        <TaskDrawer
          slug={slug}
          projectKey={openHit.projectKey}
          task={openHit}
          onClose={() => setOpenHit(null)}
        />
      )}
    </div>
  )
}

const THEME_KEY = 'pm-theme'
const COLLAPSE_KEY = 'pm-sidebar-collapsed'

/** 初始化主题（main.tsx 启动时也会调用，保证首帧无闪烁） */
export function applyStoredTheme() {
  const light = localStorage.getItem(THEME_KEY) === 'light'
  document.documentElement.classList.toggle('light', light)
}

/** best-effort 解析 JWT payload 拿当前用户显示名/邮箱（仅用于展示，失败则回退） */
function currentUser(): { name: string; email: string } {
  try {
    const token = getAccessToken()
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      const name = payload.displayName ?? payload.name ?? payload.username ?? ''
      // sub 可能是数字用户 id，只有形如邮箱时才当 email 展示
      const email =
        payload.email ??
        (typeof payload.sub === 'string' && payload.sub.includes('@') ? payload.sub : '')
      if (name || email) return { name: name || email.split('@')[0], email }
    }
  } catch {
    // 解析失败走回退
  }
  return { name: '', email: '' }
}

interface NavItem {
  path: string
  label: string
  icon: IconName
  count?: number
}

function SideNavLink({ item, expanded }: { item: NavItem; expanded: boolean }) {
  return (
    <NavLink
      to={item.path}
      title={item.label}
      className={({ isActive }) => (isActive ? '' : 'nav-link')}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 32,
        padding: '0 10px',
        borderRadius: 7,
        fontSize: 13,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background .1s, color .1s',
        textDecoration: 'none',
        justifyContent: expanded ? undefined : 'center',
        ...(isActive
          ? { background: 'var(--accent-soft)', color: 'var(--text)', fontWeight: 550 }
          : { color: 'var(--dim)', fontWeight: 450 }),
      })}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              style={{
                position: 'absolute',
                left: -8,
                top: 7,
                bottom: 7,
                width: 2.5,
                borderRadius: 2,
                background: 'var(--accent)',
              }}
            />
          )}
          <Icon name={item.icon} size={16} />
          {expanded && <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{item.label}</span>}
          {expanded && item.count != null && (
            <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
              {item.count}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

/** 点击外部关闭的下拉容器 */
function Dropdown({
  open,
  onClose,
  children,
  style,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  style?: CSSProperties
}) {
  if (!open) return null
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={onClose} />
      <div
        style={{
          position: 'absolute',
          top: 36,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow)',
          padding: 5,
          zIndex: 40,
          animation: 'fadeIn .1s',
          ...style,
        }}
      >
        {children}
      </div>
    </>
  )
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 9px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}

export default function Layout() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t, locale, setLocale } = useI18n()

  // ---- 主题（持久化到 localStorage） ----
  const [light, setLight] = useState(() => localStorage.getItem(THEME_KEY) === 'light')
  useEffect(() => {
    document.documentElement.classList.toggle('light', light)
    localStorage.setItem(THEME_KEY, light ? 'light' : 'dark')
  }, [light])

  // ---- 侧边栏折叠 ----
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])
  const expanded = !collapsed

  // ---- 菜单开关 ----
  const [projMenu, setProjMenu] = useState(false)
  const [userMenu, setUserMenu] = useState(false)

  // ---- 数据（react-query 缓存与各页面共享，不产生重复请求） ----
  const { data: tenants } = useMyTenants()
  // URL 的 slug 不在「我所属的租户」里 → 该租户所有 API 都会 404（正确的跨租户隔离），
  // 别让用户卡在满屏「加载失败」，直接送回租户选择页。
  useEffect(() => {
    if (tenants && slug && !tenants.some((t) => t.slug === slug)) {
      navigate('/tenants', { replace: true })
    }
  }, [tenants, slug, navigate])
  const tenantName = tenants?.find((t) => t.slug === slug)?.name ?? slug
  const { data: projects } = useProjects(slug)
  // 当前项目：URL ?project=（深链）→ 记忆的选中项目 → 第一个项目，全站联动
  const [searchParams, setSearchParams] = useSearchParams()
  const storedProjectKey = useSelectedProjectKey(slug)
  const projectKey = resolveProjectKey(searchParams.get('project'), storedProjectKey, projects)
  const project = projects?.find((p) => p.key === projectKey)

  function handleSwitchProject(key: string) {
    setSelectedProjectKey(slug, key)
    // URL 上带着 ?project= 深链时同步改写，避免 URL 覆盖切换结果
    if (searchParams.get('project')) {
      const next = new URLSearchParams(searchParams)
      next.set('project', key)
      setSearchParams(next, { replace: true })
    }
    setProjMenu(false)
  }
  const { data: backlogTasks } = useBacklog(slug, projectKey)
  const { data: dashboard } = useDashboard(slug, projectKey)
  const boardCount = dashboard?.counts
    ? Object.values(dashboard.counts).reduce((a, b) => a + b, 0)
    : undefined

  const user = currentUser()

  const navMain: NavItem[] = [
    { path: 'dashboard', label: t.navDashboard, icon: 'dashboard' },
    { path: 'backlog', label: t.navBacklog, icon: 'backlog', count: backlogTasks?.length },
    { path: 'board', label: t.navBoard, icon: 'board', count: boardCount },
    { path: 'sprints', label: t.navAllSprints, icon: 'sprints' },
    { path: 'planning', label: t.navPlanning, icon: 'planning' },
    { path: 'reports', label: t.navReports, icon: 'reports' },
    { path: 'roadmap', label: t.navRoadmap, icon: 'roadmap' },
  ]
  const navAdmin: NavItem[] = [
    { path: 'admin', label: t.navAdmin, icon: 'admin' },
    { path: 'settings', label: t.navSettings, icon: 'settings' },
  ]

  function handleLogout() {
    clearTokens()
    // 清空 react-query 缓存，避免下个账号首帧看到上个账号的数据
    queryClient.clear()
    navigate('/login')
  }

  const [showCreateDialog, setShowCreateDialog] = useState(false)

  function handleCreate() {
    setShowCreateDialog(true)
  }

  function handleRefresh() {
    queryClient.invalidateQueries()
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--text)',
        textAlign: 'left',
      }}
    >
      {/* ============ 侧边栏 ============ */}
      <aside
        style={{
          width: collapsed ? 60 : 224,
          flex: 'none',
          background: 'var(--panel)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width .16s ease',
          overflow: 'hidden',
        }}
      >
        {/* logo 区 */}
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '0 14px',
            flex: 'none',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 13,
              flex: 'none',
              letterSpacing: '-0.02em',
            }}
          >
            跬
          </div>
          {expanded && (
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, overflow: 'hidden' }}>
              <span
                style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text)', whiteSpace: 'nowrap' }}
                title={tenantName}
              >
                {tenantName}
              </span>
              <span style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap' }}>跬步 Kuibu</span>
            </div>
          )}
        </div>

        {/* 导航 */}
        <nav
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {navMain.map((item) => (
            <SideNavLink key={item.path} item={item} expanded={expanded} />
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '8px 6px' }} />
          {navAdmin.map((item) => (
            <SideNavLink key={item.path} item={item} expanded={expanded} />
          ))}
        </nav>

        {/* 底部用户区 */}
        <div
          style={{
            flex: 'none',
            borderTop: '1px solid var(--border)',
            padding: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            justifyContent: expanded ? undefined : 'center',
          }}
        >
          <Avatar name={user.name || t.me} size={26} />
          {expanded && (
            <>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  lineHeight: 1.15,
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 550, whiteSpace: 'nowrap' }}>{user.name || t.me}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--faint)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {user.email || slug}
                </span>
              </div>
              <span className="icon-btn" title={t.collapseSidebar} onClick={() => setCollapsed(true)} style={{ display: 'flex', flex: 'none', color: 'var(--faint)' }}>
                <Icon name="panel" size={16} />
              </span>
            </>
          )}
        </div>
      </aside>

      {/* ============ 主区 ============ */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 顶栏 */}
        <header
          style={{
            height: 52,
            flex: 'none',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px',
            background: 'var(--bg)',
          }}
        >
          {collapsed && (
            <span className="icon-btn" title={t.expandSidebar} onClick={() => setCollapsed(false)} style={{ display: 'flex', flex: 'none' }}>
              <Icon name="panel" size={16} />
            </span>
          )}

          {/* 项目切换 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setProjMenu((v) => !v)
                setUserMenu(false)
              }}
              className="hover-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 30,
                padding: '0 9px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 550,
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--accent)' }} />
              {project?.name ?? t.project}
              <Icon name="chevron" size={13} style={{ color: 'var(--faint)' }} />
            </button>
            <Dropdown open={projMenu} onClose={() => setProjMenu(false)} style={{ left: 0, width: 220 }}>
              <div
                style={{
                  padding: '5px 9px',
                  fontSize: 10.5,
                  color: 'var(--faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t.switchProject}
              </div>
              {(projects ?? []).map((p) => {
                const active = p.key === projectKey
                return (
                  <div
                    key={p.id}
                    className={active ? undefined : 'menu-item'}
                    style={{
                      ...menuItemStyle,
                      background: active ? 'var(--accent-soft)' : undefined,
                      color: active ? 'var(--text)' : 'var(--dim)',
                    }}
                    onClick={() => handleSwitchProject(p.key)}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--accent)' }} />
                    {p.name}
                    <span style={{ flex: 1 }} />
                    {active && <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />}
                  </div>
                )
              })}
              <div
                className="menu-item"
                style={{ ...menuItemStyle, color: 'var(--dim)' }}
                onClick={() => {
                  setProjMenu(false)
                  navigate('admin')
                }}
              >
                <Icon name="plus" size={14} />
                {t.newProject}
              </div>
            </Dropdown>
          </div>

          <div style={{ flex: 1 }} />

          {/* 全局搜索：全租户关键词搜索（标题/描述），点结果开任务抽屉 */}
          <GlobalSearch slug={slug} />

          {/* 新建 */}
          <button
            onClick={handleCreate}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 30,
              padding: '0 11px 0 9px',
              borderRadius: 7,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Icon name="plus" size={14} />
            {t.newTask}
          </button>

          {/* 刷新 */}
          <span className="icon-btn" title={t.refreshData} onClick={handleRefresh} style={{ display: 'flex', flex: 'none' }}>
            <Icon name="refresh" size={15} />
          </span>

          {/* 主题切换：dark 显示 sun（点击去 light），light 显示 moon */}
          <span
            className="icon-btn"
            title={t.toggleTheme}
            onClick={() => setLight((v) => !v)}
            style={{ display: 'flex', flex: 'none' }}
          >
            <Icon name={light ? 'moon' : 'sun'} size={17} />
          </span>

          {/* 用户菜单 */}
          <div style={{ position: 'relative' }}>
            <span
              onClick={() => {
                setUserMenu((v) => !v)
                setProjMenu(false)
              }}
              style={{ cursor: 'pointer', display: 'flex' }}
            >
              <Avatar name={user.name || t.me} size={28} />
            </span>
            <Dropdown open={userMenu} onClose={() => setUserMenu(false)} style={{ right: 0, width: 170 }}>
              <div
                className="menu-item"
                style={{ ...menuItemStyle, color: 'var(--text)' }}
                onClick={() => {
                  setUserMenu(false)
                  navigate('settings')
                }}
              >
                {t.personalSettings}
              </div>
              <div
                className="menu-item"
                style={{ ...menuItemStyle, color: 'var(--text)' }}
                onClick={() => {
                  setUserMenu(false)
                  navigate('/tenants')
                }}
              >
                {t.switchTenant}
              </div>
              <div
                className="menu-item"
                style={{ ...menuItemStyle, color: 'var(--text)' }}
                onClick={() => {
                  setUserMenu(false)
                  setLocale(locale === 'zh' ? 'en' : 'zh')
                }}
              >
                {t.language}：{locale === 'zh' ? '中文' : 'English'}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
              <div className="hover-card" style={{ ...menuItemStyle, color: 'var(--type-bug)' }} onClick={handleLogout}>
                {t.logout}
              </div>
            </Dropdown>
          </div>
        </header>

        {/* 内容区 */}
        <main
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <Outlet />
        </main>
      </div>

      {showCreateDialog && projectKey && (
        <CreateTaskDialog
          slug={slug}
          projectKey={projectKey}
          onClose={() => setShowCreateDialog(false)}
        />
      )}
    </div>
  )
}
