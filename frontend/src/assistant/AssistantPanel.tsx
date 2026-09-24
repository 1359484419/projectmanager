// 助手面板：右侧抽屉（宽 420，移动端全屏）。消息流 + 底部输入框（Enter 发送，Shift+Enter 换行）+ 新会话。
// 上下文（slug / 当前项目 / 当前页面）由 useAssistant 自动带入请求；写入成功后失效 [slug] 查询缓存。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, btnGhost } from '../components/ui'
import { useT } from '../i18n'
import ConfirmCard from './ConfirmCard'
import ErrorCard from './ErrorCard'
import ResultCard from './ResultCard'
import { RETRYABLE_CODES, useAssistant } from './useAssistant'
import { useVoiceInput } from './voice'

/** Markdown 子集：段落 / 列表行 / **粗体** / `代码`。不引第三方库，不渲染 HTML */
function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const isList = /^\s*[-*•]\s+/.test(line)
    const body = isList ? line.replace(/^\s*[-*•]\s+/, '') : line
    return (
      <div key={i} style={isList ? { paddingLeft: 14, position: 'relative' } : undefined}>
        {isList && <span style={{ position: 'absolute', left: 2, color: 'var(--faint)' }}>•</span>}
        {renderInline(body)}
        {!isList && line === '' && <br />}
      </div>
    )
  })
}

function renderInline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <code key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92em', background: 'var(--card-2)', padding: '0 4px', borderRadius: 4 }}>
          {p.slice(1, -1)}
        </code>
      )
    }
    return p
  })
}

export default function AssistantPanel({
  slug,
  projectKey,
  projectName,
  open,
  onClose,
}: {
  slug: string
  projectKey: string | null
  projectName?: string
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const a = useAssistant(slug, projectKey)
  const voice = useVoiceInput()
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 打开时恢复上次线程 + 聚焦输入框
  const restore = a.restore
  useEffect(() => {
    if (!open) return
    void restore()
    inputRef.current?.focus()
  }, [open, restore])

  // 新消息到达自动滚到底
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [a.items, a.busy])

  if (!open) return null

  // 有确认卡挂起时不能发新消息（服务端会 409 THREAD_PENDING；先处理卡片）
  const blocked = a.pending.length > 0

  function submit() {
    const v = text.trim()
    if (!v || a.busy || blocked) return
    setText('')
    void a.send(v)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') onClose()
  }

  function go(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <div className="assistant-panel" role="dialog" aria-modal="false" aria-label={t.assistant.title}>
      <div className="assistant-head">
        <Icon name="sparkles" size={16} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 650 }}>{t.assistant.title}</span>
        {projectName && (
          <span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.assistant.contextProject(projectName)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="hover-card" style={{ ...btnGhost, height: 26, padding: '0 9px', fontSize: 12 }} onClick={a.reset} disabled={a.busy}>
          {t.assistant.newChat}
        </button>
        <span className="icon-btn" title={t.close} onClick={onClose} style={{ display: 'flex' }}>
          <Icon name="x" size={16} />
        </span>
      </div>

      <div className="assistant-list" ref={listRef}>
        {a.items.length === 0 && (
          <div style={{ padding: '24px 6px', fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.7 }}>
            <div style={{ color: 'var(--faint)', marginBottom: 6 }}>{t.assistant.emptyHint}</div>
            {t.assistant.examples.map((ex) => (
              <div key={ex} className="assistant-example hover-card" onClick={() => setText(ex)}>
                「{ex}」
              </div>
            ))}
          </div>
        )}
        {a.items.map((it, i) => {
          switch (it.kind) {
            case 'user':
              return (
                <div key={i} className="assistant-msg assistant-msg-user">
                  {it.text}
                </div>
              )
            case 'assistant':
              return (
                <div key={i} className="assistant-msg assistant-msg-bot">
                  {renderMarkdown(it.text)}
                </div>
              )
            case 'tool':
              return (
                <div key={it.callId} className="assistant-tool" data-status={it.status}>
                  <span
                    className={it.status === 'running' ? 'assistant-dot assistant-dot-running' : 'assistant-dot'}
                    style={{ background: it.status === 'error' ? 'var(--type-bug)' : it.status === 'ok' ? 'var(--done)' : 'var(--accent)' }}
                  />
                  {it.status === 'running'
                    ? t.assistant.toolRunning(it.label)
                    : it.status === 'ok'
                      ? t.assistant.toolDone(it.label)
                      : t.assistant.toolFailed(it.label)}
                  {it.summary && <span style={{ color: 'var(--faint)' }}> · {it.summary}</span>}
                </div>
              )
            case 'confirm':
              return (
                <ConfirmCard key={it.card.callId} card={it.card} decided={it.decided} outcome={it.outcome} disabled={a.busy} onDecide={(d) => void a.decide(d)} />
              )
            case 'result':
              return (
                <ResultCard
                  key={it.card.callId}
                  card={it.card}
                  disabled={a.busy}
                  onOpen={go}
                  onUndo={(key) => void a.send(t.assistant.undoPrompt(key))}
                />
              )
            case 'error':
              return (
                <ErrorCard
                  key={i}
                  code={it.code}
                  message={it.message}
                  fallback={it.fallback}
                  canRetry={RETRYABLE_CODES.has(it.code) && i === a.items.length - 1}
                  disabled={a.busy}
                  onRetry={() => void a.retry()}
                  onManual={go}
                />
              )
            default:
              return null
          }
        })}
        {a.busy && (
          <div className="assistant-tool">
            <span className="assistant-dot assistant-dot-running" style={{ background: 'var(--accent)' }} />
            {t.assistant.thinking}
          </div>
        )}
        {a.pending.length > 1 && (
          <div style={{ fontSize: 11.5, color: 'var(--faint)', padding: '2px 4px' }}>{t.assistant.waitingOthers}</div>
        )}
      </div>

      <div className="assistant-input">
        {/* 麦克风按钮位：语音输入下期实现，本期 hidden */}
        <span className="icon-btn" title={t.assistant.voiceSoon} hidden={voice.status === 'unsupported'} style={{ display: voice.status === 'unsupported' ? 'none' : 'flex' }}>
          <Icon name="mic" size={16} />
        </span>
        <textarea
          ref={inputRef}
          value={text}
          rows={2}
          placeholder={blocked ? t.assistant.pendingHint : t.assistant.placeholder}
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t.assistant.title}
        />
        <button
          type="button"
          className="btn-primary assistant-send"
          title={t.assistant.send}
          aria-label={t.assistant.send}
          disabled={a.busy || blocked || !text.trim()}
          onClick={submit}
        >
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  )
}
