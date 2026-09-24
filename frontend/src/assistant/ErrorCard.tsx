// 错误卡：人话说明 + 原因码 + 「重试」（仅连接层失败可重试）+ 「手动去做」（跳到兜底页面）。
import { Icon, btnGhost, btnSecondary } from '../components/ui'
import { useT } from '../i18n'
import type { Fallback } from './types'

export default function ErrorCard({
  code,
  message,
  fallback,
  canRetry,
  disabled,
  onRetry,
  onManual,
}: {
  code: string
  message: string
  fallback?: Fallback
  canRetry: boolean
  disabled?: boolean
  onRetry: () => void
  onManual: (path: string) => void
}) {
  const t = useT()
  return (
    <div className="assistant-card" role="alert" style={{ borderColor: 'var(--type-bug)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--type-bug)', fontWeight: 650, fontSize: 13 }}>
        <Icon name="alert" size={14} />
        {t.assistant.errorTitle}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)', marginLeft: 'auto' }}>{code}</span>
      </div>
      <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{message}</div>
      {(canRetry || fallback) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          {fallback && (
            <button type="button" className="hover-card" style={{ ...btnGhost, height: 28, padding: '0 10px' }} onClick={() => onManual(fallback.path)}>
              {fallback.label || t.assistant.manual}
            </button>
          )}
          {canRetry && (
            <button type="button" style={{ ...btnSecondary, height: 28 }} disabled={disabled} onClick={onRetry}>
              {t.assistant.retry}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
