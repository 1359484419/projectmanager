// 确认卡（L2/L3）：逐字段 before → after、风险说明；三个按钮对应 approve / edit / reject。
// L3（删除）红色，需二次点击（第一次变「再点一次确认删除」，3 秒后复位）。
// 过期（Date.now() > expiresAt）：确认/修改禁用并提示，「取消」仍可点（服务端回 CARD_EXPIRED 收尾本轮，之后可重新发起；
// 直接重新发起时 useAssistant 也会先自动取消过期卡）。决策后按钮区替换为决策结果。
// 「修改后确认」表单按字段类型渲染：任务/长期计划状态下拉（显示中文、提交枚举码）、天数 0.5-5 档位下拉、
// 布尔复选框、容量数字框、其余文本——枚举/档位在前端就锁死，不会被后端 INVALID_PARAMS 拒。
// 决策后的展示态跟服务端 tool_result 走（decisionStatus）：拿到 ok=false 显示「未执行 + 原因」，没拿到之前只说「已提交」。
import { useEffect, useState } from 'react'
import { Icon, btnDanger, btnGhost, btnPrimary, btnSecondary, inputStyle, statusLabel } from '../components/ui'
import { useT, type Translations } from '../i18n'
import type { TaskStatus } from '../api/types'
import { fmtPoints } from '../utils/points'
import { buildEditArgs, decisionStatus, editControlKind, pointsOptions, type CardOutcome } from './reducer'
import type { Card, Decision } from './types'

const STATUS_KEYS: readonly TaskStatus[] = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'DONE']
const EPIC_STATUS_KEYS = ['OPEN', 'DONE'] as const

/** 展示值：状态枚举翻译成当前语言的状态名，其余原样 */
function formatValue(v: unknown, t: Translations): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return (STATUS_KEYS as readonly string[]).includes(v) ? statusLabel(t)[v as TaskStatus] : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.length === 0 ? t.assistant.unchanged : v.map((x) => formatValue(x, t)).join('、')
  return JSON.stringify(v)
}

export default function ConfirmCard({
  card,
  decided,
  outcome,
  disabled,
  onDecide,
}: {
  card: Card
  decided?: Decision
  /** 决策提交后服务端回的真实结果（tool_result）；未回之前为空 */
  outcome?: CardOutcome
  /** 面板忙碌时禁止再决策 */
  disabled?: boolean
  onDecide: (d: Decision) => void
}) {
  const t = useT()
  const danger = card.risk === 'L3'
  const [armed, setArmed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())

  const expiresAt = Date.parse(card.expiresAt)
  const expired = Number.isFinite(expiresAt) && now > expiresAt

  // 未决策时每秒刷新一次，过期即刻置灰
  useEffect(() => {
    if (decided || expired) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [decided, expired])

  // 二次确认 3 秒后复位
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  // 过期只锁「确认/修改」：「取消」保留，否则过期卡 + 被它阻塞的输入框会把面板锁死（只能「新会话」）
  const locked = !!decided || expired || !!disabled
  const rejectLocked = !!decided || !!disabled
  const allowed = new Set(card.allowedDecisions)

  function approve() {
    if (danger && !armed) {
      setArmed(true)
      return
    }
    onDecide({ callId: card.callId, type: 'approve' })
  }

  function origValue(f: string): unknown {
    return card.args[f] ?? card.changes.find((c) => c.field === f)?.after
  }

  function startEdit() {
    const init: Record<string, string> = {}
    for (const f of card.editable) {
      const cur = origValue(f)
      init[f] = cur === null || cur === undefined ? '' : typeof cur === 'string' ? cur : JSON.stringify(cur)
    }
    setDraft(init)
    setEditing(true)
  }

  function setField(f: string, v: string) {
    setDraft((d) => ({ ...d, [f]: v }))
  }

  function renderControl(f: string) {
    const orig = origValue(f)
    const kind = editControlKind(f, orig, card.tool)
    const value = draft[f] ?? ''
    const style = { ...inputStyle, height: 30, marginTop: 3 }
    if (kind === 'epicStatus') {
      const labels = { OPEN: t.epicStatusOpen, DONE: t.epicStatusDone }
      return (
        <select style={style} value={value} onChange={(e) => setField(f, e.target.value)}>
          <option value="">—</option>
          {EPIC_STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
      )
    }
    if (kind === 'points') {
      return (
        <select style={style} value={value} onChange={(e) => setField(f, e.target.value)}>
          <option value="">—</option>
          {pointsOptions(orig).map((pt) => (
            <option key={pt} value={String(pt)}>
              {fmtPoints(pt)}
            </option>
          ))}
        </select>
      )
    }
    if (kind === 'status') {
      const labels = statusLabel(t)
      return (
        <select style={style} value={value} onChange={(e) => setField(f, e.target.value)}>
          <option value="">—</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
      )
    }
    if (kind === 'boolean') {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, height: 30 }}>
          <input type="checkbox" checked={value === 'true'} onChange={(e) => setField(f, e.target.checked ? 'true' : 'false')} />
          {value === 'true' ? t.assistant.editTrue : t.assistant.editFalse}
        </span>
      )
    }
    if (kind === 'number') {
      return <input type="number" step={0.5} min={0} style={style} value={value} onChange={(e) => setField(f, e.target.value)} />
    }
    return <input style={style} value={value} onChange={(e) => setField(f, e.target.value)} />
  }

  function submitEdit() {
    // 只提交 editable 且改动过的字段；定位字段（taskKey 等）不发，否则 guard 会按白名单拒绝（INVALID_DECISION）
    onDecide({ callId: card.callId, type: 'edit', args: buildEditArgs(card, draft) })
    setEditing(false)
  }

  const accent = danger ? 'var(--type-bug)' : 'var(--accent)'
  const minutesLeft = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - now) / 60000)) : null

  return (
    <div
      className="assistant-card"
      data-risk={card.risk}
      role="group"
      aria-label={t.assistant.confirmTitle(card.title)}
      style={{ borderColor: accent }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: accent, fontWeight: 650, fontSize: 13 }}>
        <Icon name={danger ? 'trash' : 'alert'} size={14} />
        {t.assistant.confirmTitle(card.title)}
      </div>
      <div style={{ fontSize: 12.5, marginTop: 4, fontWeight: 550 }}>{card.target}</div>

      {card.changes.length > 0 && (
        <table className="assistant-diff">
          <tbody>
            {card.changes.map((c) => {
              const same = JSON.stringify(c.before) === JSON.stringify(c.after)
              return (
                <tr key={c.field}>
                  <td className="assistant-diff-label">{c.label}</td>
                  <td>
                    {same ? (
                      <span>
                        {formatValue(c.before, t)}
                        <span style={{ color: 'var(--faint)', marginLeft: 6 }}>（{t.assistant.unchanged}）</span>
                      </span>
                    ) : (
                      <span>
                        <span style={{ color: 'var(--dim)', textDecoration: 'line-through' }}>
                          {formatValue(c.before, t)}
                        </span>
                        <Icon name="arrowRight" size={12} style={{ margin: '0 6px', verticalAlign: '-2px', color: 'var(--faint)' }} />
                        <b style={{ color: accent }}>{formatValue(c.after, t)}</b>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {card.impact && (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>
          {t.assistant.riskLabel}：{card.impact}
        </div>
      )}

      {editing && !locked && (
        <div className="assistant-edit">
          {card.editable.map((f) => {
            const label = card.changes.find((c) => c.field === f)?.label ?? f
            return (
              <label key={f} style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>
                {label}
                {renderControl(f)}
              </label>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {decided ? (
          (() => {
            const st = decisionStatus(decided, outcome)
            if (st === 'failed') {
              return (
                <span data-decision="failed" style={{ fontSize: 12, color: 'var(--type-bug)' }}>
                  {t.assistant.decidedFailed(outcome?.message || outcome?.code || '')}
                </span>
              )
            }
            return (
              <span data-decision={st} style={{ fontSize: 12, color: 'var(--dim)' }}>
                {st === 'done'
                  ? decided.type === 'edit'
                    ? t.assistant.decidedEditDone
                    : t.assistant.decidedApproveDone
                  : st === 'rejected'
                    ? t.assistant.decidedReject
                    : decided.type === 'edit'
                      ? t.assistant.decidedEdit
                      : t.assistant.decidedApprove}
              </span>
            )
          })()
        ) : expired ? (
          <span style={{ fontSize: 12, color: 'var(--type-bug)' }}>{t.assistant.expired}</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>
            {minutesLeft != null && t.assistant.expiresIn(minutesLeft)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!decided && (
          <>
            {allowed.has('reject') && (
              <button
                type="button"
                className="hover-card"
                style={{ ...btnGhost, height: 28, padding: '0 10px' }}
                disabled={rejectLocked}
                onClick={() => onDecide({ callId: card.callId, type: 'reject' })}
              >
                {t.assistant.reject}
              </button>
            )}
            {allowed.has('edit') && card.editable.length > 0 && (
              editing ? (
                <>
                  <button type="button" style={{ ...btnSecondary, height: 28 }} disabled={locked} onClick={() => setEditing(false)}>
                    {t.assistant.editCancel}
                  </button>
                  <button type="button" className="btn-primary" style={{ ...btnPrimary, height: 28 }} disabled={locked} onClick={submitEdit}>
                    {t.assistant.editSubmit}
                  </button>
                </>
              ) : (
                <button type="button" style={{ ...btnSecondary, height: 28 }} disabled={locked} onClick={startEdit}>
                  {t.assistant.edit}
                </button>
              )
            )}
            {allowed.has('approve') && !editing && (
              <button
                type="button"
                className="btn-primary"
                style={danger ? { ...btnDanger, height: 28, padding: '0 12px' } : { ...btnPrimary, height: 28 }}
                disabled={locked}
                onClick={approve}
              >
                {danger ? (armed ? t.assistant.approveDeleteAgain : t.assistant.approveDelete) : t.assistant.approve}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
