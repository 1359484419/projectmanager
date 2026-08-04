// 记录页：RECORD 类型任务列表（发票报销等备忘），支持提醒状态展示，点击开抽屉看图片/详情
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProjects, useRecords } from '../api/hooks'
import type { Task, TaskBrief } from '../api/types'
import TaskDrawer from '../components/TaskDrawer'
import TypeIcon from '../components/TypeIcon'
import { SelectWrap, cardStyle, pageTitleStyle, selStyle } from '../components/ui'
import { resolveProjectKey, setSelectedProjectKey, useSelectedProjectKey } from '../state/selectedProject'
import { useI18n, useT } from '../i18n'

function ReminderBadge({ task }: { task: Task }) {
  const t = useT()
  if (!task.remindAt) return null
  const due = new Date(task.remindAt).getTime() <= Date.now()
  const label = task.reminderDismissed ? t.reminderDone : due ? t.reminderActive : t.reminderPending
  const color = task.reminderDismissed ? 'var(--faint)' : due ? 'var(--type-bug)' : 'var(--prog)'
  return (
    <span
      style={{
        fontSize: 11,
        color,
        border: `1px solid ${color}`,
        borderRadius: 20,
        padding: '1px 8px',
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      {label}
    </span>
  )
}

export default function Records() {
  const { slug = '' } = useParams()
  const t = useT()
  const { locale } = useI18n()
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'
  const { data: projects } = useProjects(slug)
  const storedProjectKey = useSelectedProjectKey(slug)
  const key = resolveProjectKey(null, storedProjectKey, projects) ?? ''
  const records = useRecords(slug, key)
  const [openTask, setOpenTask] = useState<TaskBrief | null>(null)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
        <h1 style={pageTitleStyle}>{t.recordsTitle}</h1>
        {projects && projects.length > 0 && (
          <SelectWrap chevronTop={9} style={{ width: 200 }}>
            <select value={key} onChange={(e) => setSelectedProjectKey(slug, e.target.value)} style={selStyle}>
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          </SelectWrap>
        )}
        <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>
          {records.data ? t.nItems(records.data.length) : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          {records.isError ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
              {t.recordsLoadFailed}
            </div>
          ) : !records.data || records.data.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>
              {t.noRecordsYet}
            </div>
          ) : (
            records.data.map((task) => (
              <div
                key={task.id}
                className="task-row"
                onClick={() => setOpenTask(task)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border-soft)',
                  cursor: 'pointer',
                }}
              >
                <TypeIcon type={task.type} size={15} />
                <span style={{ fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--font-mono)', flex: 'none' }}>
                  {key}-{task.seq}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </div>
                  {task.description && (
                    <div style={{ fontSize: 12, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {task.description}
                    </div>
                  )}
                </div>
                {task.remindAt && (
                  <span style={{ fontSize: 12, color: 'var(--dim)', flex: 'none' }}>
                    {new Date(task.remindAt).toLocaleString(dateLocale)}
                  </span>
                )}
                <ReminderBadge task={task} />
              </div>
            ))
          )}
        </div>
      </div>

      {openTask && key && (
        <TaskDrawer slug={slug} projectKey={key} task={openTask} onClose={() => setOpenTask(null)} />
      )}
    </div>
  )
}
