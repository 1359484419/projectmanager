// UI 基座：Toast 系统 / ConfirmDialog / 徽标 / 通用样式常量
// 视觉真源：docs/design/mock/markup.html（TOAST / CONFIRM 节）+ logic.jsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { TaskStatus, TaskType } from '../api/types'
import { Icon } from './icons'

export { Icon, TypeGlyph, TYPE_LABEL, type IconName } from './icons'
export { default as StatusBadge } from './StatusBadge'
export { default as TypeIcon } from './TypeIcon'

// ---------------- 状态四态映射 ----------------

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: '待办',
  IN_PROGRESS: '进行中',
  COMPLETED: '待验收',
  DONE: '已完成',
}

/** 状态 → CSS 变量名后缀：var(--todo) / var(--prog) / var(--comp) / var(--done) */
export const STATUS_VAR: Record<TaskStatus, string> = {
  TODO: 'todo',
  IN_PROGRESS: 'prog',
  COMPLETED: 'comp',
  DONE: 'done',
}

/** 状态主色，如 var(--prog) */
export function statusColor(status: TaskStatus): string {
  return `var(--${STATUS_VAR[status]})`
}

/** 状态 soft 底色，如 var(--prog-soft) */
export function statusSoft(status: TaskStatus): string {
  return `var(--${STATUS_VAR[status]}-soft)`
}

export const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'STORY', label: '故事' },
  { value: 'BUG', label: '缺陷' },
  { value: 'TASK', label: '任务' },
]

export const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'TODO', label: '待办' },
  { value: 'IN_PROGRESS', label: '进行中' },
  { value: 'COMPLETED', label: '待验收' },
  { value: 'DONE', label: '已完成' },
]

// ---------------- 通用样式常量 ----------------

/** 下拉框（设计稿 selStyle）——配合 <SelectWrap> 使用可自带 chevron */
export const selStyle: CSSProperties = {
  width: '100%',
  height: 30,
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--card-2)',
  color: 'var(--text)',
  fontSize: 12.5,
  padding: '0 26px 0 10px',
  cursor: 'pointer',
}

/** 文本输入框（设计稿表单 input） */
export const inputStyle: CSSProperties = {
  width: '100%',
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card-2)',
  color: 'var(--text)',
  fontSize: 13,
  padding: '0 11px',
  outline: 'none',
}

/** 主按钮（accent 实底） */
export const btnPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  borderRadius: 7,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
}

/** 次按钮（卡片底 + 边框） */
export const btnSecondary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 12.5,
  fontWeight: 550,
  cursor: 'pointer',
}

/** 幽灵按钮（透明底 + 边框） */
export const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 32,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 12.5,
  cursor: 'pointer',
}

/** 危险按钮（确认框的执行键） */
export const btnDanger: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 32,
  padding: '0 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--type-bug)',
  color: '#fff',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
}

/** 内容卡片容器 */
export const cardStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
}

/** 页面主标题（h1） */
export const pageTitleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 650,
  margin: 0,
}

/** 表单 label */
export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--dim)',
  marginBottom: 5,
}

/** 等宽字体（编号 / 数字） */
export const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
}

/** select + 右侧 chevron 的组合容器（设计稿所有下拉的统一形态） */
export function SelectWrap({
  children,
  style,
  chevronTop = 8,
}: {
  children: ReactNode
  style?: CSSProperties
  chevronTop?: number
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
      {children}
      <Icon
        name="chevron"
        size={12}
        style={{
          position: 'absolute',
          right: 9,
          top: chevronTop,
          color: 'var(--faint)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

// ---------------- 通用徽标 ----------------

/** 通用胶囊徽标：soft 底 + 语义色文字 */
export function Badge({
  color,
  soft,
  children,
  style,
}: {
  /** 文字色，如 var(--prog) */
  color: string
  /** 底色，如 var(--prog-soft)；缺省用 var(--card-2) */
  soft?: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        color,
        background: soft ?? 'var(--card-2)',
        borderRadius: 20,
        padding: '3px 10px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

// ---------------- Toast ----------------

export type ToastKind = 'success' | 'info'

interface ToastState {
  msg: string
  kind: ToastKind
}

interface ToastContextValue {
  /** 弹出 toast，2.6s 自动消失（同设计稿） */
  show: (msg: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} })

/** 页面中调用：const toast = useToast(); toast.show('已更新') */
export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

const TOAST_ICON: Record<ToastKind, ReactNode> = {
  success: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      style={{ display: 'block', flex: 'none' }}
    >
      <circle cx="12" cy="12" r="10" style={{ stroke: 'var(--done)' }} />
      <path d="m9 12 2 2 4-4" style={{ stroke: 'var(--done)' }} />
    </svg>
  ),
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      style={{ display: 'block', flex: 'none' }}
    >
      <circle cx="12" cy="12" r="10" style={{ stroke: 'var(--accent)' }} />
      <path d="M12 16v-4M12 8h.01" style={{ stroke: 'var(--accent)' }} />
    </svg>
  ),
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((msg: string, kind: ToastKind = 'success') => {
    setToast({ msg, kind })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: '11px 15px',
            animation: 'toastIn .16s ease',
          }}
        >
          {TOAST_ICON[toast.kind]}
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{toast.msg}</span>
        </div>
      )}
    </ToastContext.Provider>
  )
}

// ---------------- ConfirmDialog ----------------

export interface ConfirmDialogProps {
  open: boolean
  /** 标题，如「启动该 Sprint？」 */
  title: string
  /** 说明文字 */
  message?: ReactNode
  /** 执行按钮文案，如「启动」「关闭」，默认「确认」 */
  actionLabel?: string
  /** 执行按钮是否危险色（默认 true，同设计稿 var(--type-bug)） */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  actionLabel = '确认',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.5)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn .12s',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: 380,
          maxWidth: '92vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow)',
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 8 }}>{title}</div>
        {message && (
          <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 20 }}>
            {message}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button onClick={onCancel} style={btnGhost} className="hover-card">
            取消
          </button>
          <button
            onClick={onConfirm}
            style={danger ? btnDanger : { ...btnDanger, background: 'var(--accent)' }}
            className="btn-primary"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
