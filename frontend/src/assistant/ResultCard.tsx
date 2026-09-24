// 结果卡（L1 创建类执行后回显）：数据来自工具返回；「撤销创建」走 L3 确认链路（由助手发起删除）。
import { Icon, btnGhost, btnSecondary } from '../components/ui'
import { useT } from '../i18n'
import type { ResultCard as ResultCardData } from './types'

export default function ResultCard({
  card,
  disabled,
  onOpen,
  onUndo,
}: {
  card: ResultCardData
  disabled?: boolean
  onOpen: (path: string) => void
  onUndo: (key: string) => void
}) {
  const t = useT()
  return (
    <div className="assistant-card" role="group" aria-label={card.key ? `${card.title} ${card.key}` : card.title} style={{ borderColor: 'var(--done)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--done)', fontWeight: 650, fontSize: 13 }}>
        <Icon name="check" size={14} />
        {card.title}
        {card.key && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{card.key}</span>}
      </div>
      {card.summary && <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>{card.summary}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        {card.path && (
          <button type="button" style={{ ...btnSecondary, height: 28 }} onClick={() => onOpen(card.path!)}>
            {t.assistant.open}
          </button>
        )}
        {card.undoable && card.key && (
          <button type="button" className="hover-card" style={{ ...btnGhost, height: 28, padding: '0 10px' }} disabled={disabled} onClick={() => onUndo(card.key!)}>
            {t.assistant.undoCreate}
          </button>
        )}
      </div>
    </div>
  )
}
