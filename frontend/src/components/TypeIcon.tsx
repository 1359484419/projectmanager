// 任务类型图标：故事=绿色书签 / 缺陷=红色虫 / 任务=蓝灰勾选框（SVG path 来自设计稿）
import type { TaskType } from '../api/types'
import { TypeGlyph, TYPE_LABEL } from './icons'

export default function TypeIcon({ type, size = 15 }: { type: TaskType; size?: number }) {
  return (
    <span
      title={TYPE_LABEL[type]}
      style={{ display: 'inline-flex', flex: 'none', width: size, height: size }}
    >
      <TypeGlyph type={type} size={size} />
    </span>
  )
}
