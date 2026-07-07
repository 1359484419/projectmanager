// 单测：points 0.5-5 输入解析与展示格式化（与后端 TaskService.validatePoints 规则对齐）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POINTS_CHOICES,
  POINTS_RANGE_MSG,
  fmtPoints,
  parsePointsInput,
} from '../../src/utils/points.ts'

test('choices: 0.5 步进共 10 档', () => {
  assert.deepEqual(POINTS_CHOICES, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
})

test('parse: 合法值', () => {
  assert.equal(parsePointsInput('0.5'), 0.5)
  assert.equal(parsePointsInput('3'), 3)
  assert.equal(parsePointsInput('4.5'), 4.5)
  assert.equal(parsePointsInput('5'), 5)
  assert.equal(parsePointsInput(' 2.5 '), 2.5)
})

test('parse: 空输入为 null（未估点）', () => {
  assert.equal(parsePointsInput(''), null)
  assert.equal(parsePointsInput('   '), null)
})

test('parse: 超范围 / 非 0.5 步进 / 非数字为 undefined（拒绝）', () => {
  assert.equal(parsePointsInput('0'), undefined)
  assert.equal(parsePointsInput('0.4'), undefined)
  assert.equal(parsePointsInput('5.5'), undefined)
  assert.equal(parsePointsInput('8'), undefined)
  assert.equal(parsePointsInput('-1'), undefined)
  assert.equal(parsePointsInput('2.3'), undefined)
  assert.equal(parsePointsInput('abc'), undefined)
})

test('fmt: 整数不带小数点，小数保留一位', () => {
  assert.equal(fmtPoints(3), '3')
  assert.equal(fmtPoints(0.5), '0.5')
  assert.equal(fmtPoints(4.5), '4.5')
  assert.equal(fmtPoints(0.1 + 0.2), '0.3') // 浮点误差收敛
  assert.equal(fmtPoints(0), '0')
})

test('msg: 超范围提示文案', () => {
  assert.equal(POINTS_RANGE_MSG, '单任务估点 0.5-5，过大请拆分')
})
