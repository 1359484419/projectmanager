import { Link, useNavigate } from 'react-router-dom'
import { useMyTenants } from '../api/hooks'
import { clearTokens } from '../api/client'

export default function TenantSelect() {
  const navigate = useNavigate()
  const { data: tenants, isLoading, isError, error } = useMyTenants()

  function handleLogout() {
    clearTokens()
    navigate('/login')
  }

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: 24, textAlign: 'left' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: 0 }}>选择租户</h2>
        <button
          type="button"
          onClick={handleLogout}
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--text)',
            fontSize: 13,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          退出登录
        </button>
      </div>

      {isLoading && <p>加载中…</p>}
      {isError && (
        <p style={{ color: '#dc2626', fontSize: 14 }}>
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      {tenants && tenants.length === 0 && (
        <p style={{ fontSize: 14 }}>
          你还不属于任何租户。可以<Link to="/login">注册</Link>创建一个新租户，或通过邀请链接加入。
        </p>
      )}
      {tenants && tenants.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tenants.map((tenant) => (
            <li key={tenant.slug} style={{ marginBottom: 10 }}>
              <Link
                to={`/t/${tenant.slug}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 16px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: 'var(--text-h)',
                }}
              >
                <span>
                  <strong>{tenant.name}</strong>
                  <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text)' }}>
                    /{tenant.slug}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: tenant.role === 'ADMIN' ? 'var(--accent-bg)' : 'var(--code-bg)',
                    color: tenant.role === 'ADMIN' ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {tenant.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
