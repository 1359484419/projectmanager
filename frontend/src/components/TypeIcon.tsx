// 任务类型图标：故事=绿色书签 / 缺陷=红色虫 / 任务=蓝灰勾选框（SVG path 来自设计稿）
import type { TaskType } from '../api/types'
import { TypeGlyph, typeLabel } from './icons'
import { useT } from '../i18n'

export default function TypeIcon({ type, size = 15 }: { type: TaskType; size?: number }) {
  const t = useT()
  return (
    <span
      title={typeLabel(t)[type]}
      style={{ display: 'inline-flex', flex: 'none', width: size, height: size }}
    >
      <TypeGlyph type={type} size={size} />
    </span>
  )
}
