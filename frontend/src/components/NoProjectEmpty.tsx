// 「还没有项目」统一空态（概览 / 待办 / 看板 / 所有迭代 / 规划 / 报表 / 路线图 共用）：
// 同一句文案 + ADMIN 可见的主按钮「创建第一个项目」直接弹建项目对话框；MEMBER 提示联系管理员。
import { useState } from 'react'
import { useMyTenants } from '../api/hooks'
import { useT } from '../i18n'
import { canManageTenant } from '../state/tenantRole'
import CreateProjectDialog from './CreateProjectDialog'
import { Icon } from './icons'
import { btnPrimary } from './ui'

export default function NoProjectEmpty({ slug, compact }: { slug: string; compact?: boolean }) {
  const t = useT()
  const { data: tenants } = useMyTenants()
  const role = tenants?.find((tn) => tn.slug === slug)?.role
  const admin = canManageTenant(role)
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        border: '1px dashed var(--border-strong)',
        borderRadius: 12,
        padding: compact ? '28px 16px' : '48px 24px',
        textAlign: 'center',
        color: 'var(--dim)',
      }}
    >
      <p style={{ fontSize: 13, margin: '0 0 14px' }}>{admin ? t.noProjectsDashboard : t.noProjectMemberHint}</p>
      {admin && (
        <button type="button" className="btn-primary" style={btnPrimary} onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} />
          {t.createFirstProject}
        </button>
      )}
      {open && <CreateProjectDialog slug={slug} onClose={() => setOpen(false)} />}
    </div>
  )
}
