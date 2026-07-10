// EpicCard：路线图 Epic 卡片。
// 视觉真源：docs/design/mock/markup.html ROADMAP 节 —— 左侧 4px 色条 + 名称 + mono done/total
// + 6px 进度条（pct 填充 epic 自身色）+ 任务紧凑行列表（TaskCard variant="row"）。
import type { RoadmapEpic, TaskBrief } from '../api/types'
import TaskCard from './TaskCard'
import { Badge } from './ui'
import { useT } from '../i18n'

const DEFAULT_COLOR = '#6e79d6'

export interface EpicCardProps {
  epic: RoadmapEpic
  /** 项目 key，透传给任务行展示 "PM-42" 号 */
  projectKey?: string
  /** 点击列表中的任务行（开 TaskDrawer） */
  onTaskClick?: (task: TaskBrief) => void
  /** 点击卡片头部名称（打开编辑 Epic 对话框）；不传则名称不可点 */
  onEdit?: () => void
}

export default function EpicCard({ epic, projectKey, onTaskClick, onEdit }: EpicCardProps) {
  const t = useT()
  const color = epic.color || DEFAULT_COLOR
  const pct =
    epic.totalPoints > 0
      ? Math.max(0, Math.min(100, Math.round((epic.donePoints / epic.totalPoints) * 100)))
      : 0

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 11,
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      {/* 左侧颜色条 */}
      <span aria-hidden style={{ width: 4, background: color, flex: 'none' }} />
      <div style={{ padding: '13px 15px', flex: 1, minWidth: 0 }}>
        {/* 头部：名称（可点开编辑）+ done/total */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              title={t.editEpic}
              className="hover-accent"
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                padding: '1px 5px',
                margin: '-1px -5px',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: 0,
              }}
            >
              {epic.name}
            </button>
          ) : (
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {epic.name}
            </span>
          )}
          {epic.status === 'DONE' && (
            <Badge color="var(--done)" soft="var(--done-soft)" style={{ flex: 'none' }}>
              {t.epicDone}
            </Badge>
          )}
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 11,
              color: 'var(--faint)',
              fontFamily: 'var(--font-mono)',
              flex: 'none',
            }}
          >
            {epic.donePoints}/{epic.totalPoints}
          </span>
        </div>

        {/* 进度条 */}
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: 6,
            borderRadius: 4,
            background: 'var(--card-2)',
            overflow: 'hidden',
            marginBottom: 10,
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${pct}%`,
              background: color,
              borderRadius: 4,
              transition: 'width .2s',
            }}
          />
        </div>

        {/* 任务列表（紧凑行） */}
        {epic.tasks.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--faint)', padding: '4px 0' }}>
            {t.noEpicTasks}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {epic.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                projectKey={projectKey}
                variant="row"
                onClick={onTaskClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
