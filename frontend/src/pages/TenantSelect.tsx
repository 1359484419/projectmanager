import { Link, useNavigate } from 'react-router-dom'
import { useMyTenants } from '../api/hooks'
import { clearTokens } from '../api/client'
import type { Role } from '../api/types'

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: '管理员',
  MEMBER: '成员',
}

export default function TenantSelect() {
  const navigate = useNavigate()
  const { data: tenants, isLoading, isError, error } = useMyTenants()

  function handleLogout() {
    clearTokens()
    navigate('/login')
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn .15s',
      }}
    >
      <div style={{ width: 380, maxWidth: '92vw' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 26,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 22,
              marginBottom: 12,
            }}
          >
            P
          </div>
          <div style={{ fontSize: 16, fontWeight: 650 }}>选择团队</div>
          <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 3 }}>
            选择要进入的团队空间
          </div>
        </div>

        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 12,
            boxShadow: 'var(--shadow)',
          }}
        >
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="sk" style={{ height: 52 }} />
              <div className="sk" style={{ height: 52 }} />
              <div className="sk" style={{ height: 52 }} />
            </div>
          )}

          {isError && (
            <div
              style={{
                padding: '14px 8px',
                fontSize: 13,
                color: 'var(--type-bug)',
                textAlign: 'center',
              }}
            >
              加载失败：{error instanceof Error ? error.message : '未知错误'}
            </div>
          )}

          {tenants && tenants.length === 0 && (
            <div
              style={{
                padding: '18px 12px',
                fontSize: 13,
                color: 'var(--dim)',
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              你还不属于任何团队。可以
              <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                注册
              </Link>
              创建一个新团队，或通过邀请链接加入。
            </div>
          )}

          {tenants && tenants.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tenants.map((tenant) => (
                <Link
                  key={tenant.slug}
                  to={`/t/${tenant.slug}`}
                  className="hover-card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    padding: '11px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--card-2)',
                    textDecoration: 'none',
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13.5,
                        fontWeight: 700,
                        flex: 'none',
                      }}
                    >
                      {tenant.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {tenant.name}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          color: 'var(--faint)',
                          fontFamily: 'var(--font-mono)',
                          marginTop: 1,
                        }}
                      >
                        /t/{tenant.slug}
                      </span>
                    </span>
                  </span>
                  <span
                    style={{
                      flex: 'none',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: tenant.role === 'ADMIN' ? 'var(--accent-soft)' : 'var(--card)',
                      border:
                        tenant.role === 'ADMIN'
                          ? '1px solid transparent'
                          : '1px solid var(--border)',
                      color: tenant.role === 'ADMIN' ? 'var(--accent)' : 'var(--dim)',
                    }}
                  >
                    {ROLE_LABEL[tenant.role] ?? tenant.role}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <p style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleLogout}
            className="hover-text"
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--dim)',
              fontSize: 13,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            退出登录
          </button>
        </p>
      </div>
    </div>
  )
}
