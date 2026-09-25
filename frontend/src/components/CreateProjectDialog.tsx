// 新建项目对话框：键（2-6 大写字母）+ 名称。
// 入口：无项目空态的「创建第一个项目」、顶栏项目下拉的「新建项目」（仅 ADMIN）。
// 成功后把新项目设为当前选中项目，让概览/待办等页面立即切过去。
import { useEffect, useState, type FormEvent } from 'react'
import { useCreateProject } from '../api/hooks'
import { apiErrorMessage } from '../api/errors'
import { useT } from '../i18n'
import { setSelectedProjectKey } from '../state/selectedProject'
import { btnGhost, btnPrimary, inputStyle, labelStyle, useToast } from './ui'

const KEY_PATTERN = /^[A-Z]{2,6}$/

export default function CreateProjectDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const createProject = useCreateProject(slug)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const keyOk = KEY_PATTERN.test(key)
  const valid = keyOk && name.trim().length > 0

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid || createProject.isPending) return
    createProject.mutate(
      { key, name: name.trim() },
      {
        onSuccess: (p) => {
          setSelectedProjectKey(slug, p.key)
          toast.show(t.projectCreated)
          onClose()
        },
        onError: (err) => toast.show(t.createFailed(apiErrorMessage(err, t)), 'info'),
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.createProjectDialogTitle}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.5)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn .12s',
      }}
    >
      <form
        onSubmit={submit}
        noValidate
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: '92vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow)',
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 16 }}>{t.createProjectDialogTitle}</div>

        <label style={labelStyle} htmlFor="project-key">
          {t.projectKeyAria}
        </label>
        <input
          id="project-key"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onBlur={() => setTouched(true)}
          placeholder={t.projectKeyPlaceholder}
          aria-label={t.projectKeyAria}
          autoFocus
          style={{
            ...inputStyle,
            fontFamily: 'var(--font-mono)',
            marginBottom: 4,
            borderColor: touched && !keyOk ? 'var(--type-bug)' : 'var(--border)',
          }}
        />
        <div style={{ fontSize: 11, color: touched && !keyOk ? 'var(--type-bug)' : 'var(--faint)', marginBottom: 12 }}>
          {t.projectKeyHint}
        </div>

        <label style={labelStyle} htmlFor="project-name">
          {t.projectNameAria}
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.projectNamePlaceholder}
          aria-label={t.projectNameAria}
          style={{ ...inputStyle, marginBottom: 20 }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button type="button" onClick={onClose} style={btnGhost} className="hover-card">
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={!valid || createProject.isPending}
            className="btn-primary"
            style={{
              ...btnPrimary,
              height: 32,
              padding: '0 16px',
              borderRadius: 8,
              opacity: !valid || createProject.isPending ? 0.6 : 1,
            }}
          >
            {createProject.isPending ? t.creating : t.create}
          </button>
        </div>
      </form>
    </div>
  )
}
