// 单测：i18n 两份文案键同构 + 术语（审查 P1「看板被译成仪表盘」/ P2「空态提示互相矛盾」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zh from '../../src/i18n/zh.ts'
import en from '../../src/i18n/en.ts'

function keysDeep(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? keysDeep(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

test('i18n: zh / en 键集合完全一致', () => {
  const a = keysDeep(zh as unknown as Record<string, unknown>).sort()
  const b = keysDeep(en as unknown as Record<string, unknown>).sort()
  assert.deepEqual(a, b)
})

test('i18n: 看板术语——navBoard/board 为「看板」/「Board」，不再与概览冲突', () => {
  assert.equal(zh.navBoard, '看板')
  assert.equal(zh.board, '看板')
  assert.equal(en.navBoard, 'Board')
  assert.equal(en.board, 'Board')
  assert.notEqual(zh.navBoard, zh.navDashboard)
  assert.notEqual(en.navBoard, en.navDashboard)
})

test('i18n: 「无项目」空态三处统一为同一句', () => {
  assert.equal(zh.noProjectsYet, zh.noProjectsDashboard)
  assert.equal(zh.noProjectPlanning, zh.noProjectsDashboard)
  assert.doesNotMatch(zh.noProjectPlanning, /待办页/)
  assert.doesNotMatch(zh.noProjectsYet, /租户管理/)
})

test('i18n: 迭代空态 CTA 指向「所有迭代」而不是规划页', () => {
  assert.doesNotMatch(zh.noActiveSprintBoard('PM'), /规划页/)
  assert.doesNotMatch(zh.noSprintReports, /规划页/)
  assert.match(zh.startSprintHint, /请先关闭/)
  assert.doesNotMatch(zh.startSprintHint, /将被关闭/)
})

test('i18n: 中文版无英文残留（新增键抽查）', () => {
  for (const s of [zh.createFirstProject, zh.newTaskNeedProject, zh.goToAllSprints, zh.memberReadOnlyHint]) {
    assert.doesNotMatch(s, /[A-Za-z]/, s)
  }
})

test('i18n: 每份文案自带 locale 标识（apiErrorMessage 据此决定是否直出后端中文）', () => {
  assert.equal(zh.locale, 'zh')
  assert.equal(en.locale, 'en')
})
