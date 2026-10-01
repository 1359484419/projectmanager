// 单测：子任务附件纯规则（图片类型判断 / 5MB 上限），TaskDrawer SubtaskAttachmentsBlock 依赖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTACHMENT_MAX_BYTES,
  isAttachmentTooLarge,
  isImageAttachment,
} from '../../src/utils/attachments.ts'

test('isImageAttachment: image/* 为图片', () => {
  assert.equal(isImageAttachment('image/png'), true)
  assert.equal(isImageAttachment('image/jpeg'), true)
  assert.equal(isImageAttachment('image/webp'), true)
  assert.equal(isImageAttachment('IMAGE/GIF'), true)
  assert.equal(isImageAttachment(' image/png '), true)
})

test('isImageAttachment: 文档 / 空值不是图片', () => {
  assert.equal(isImageAttachment('application/pdf'), false)
  assert.equal(isImageAttachment('text/plain'), false)
  assert.equal(isImageAttachment('application/octet-stream'), false)
  assert.equal(isImageAttachment('imagex/png'), false)
  assert.equal(isImageAttachment(''), false)
  assert.equal(isImageAttachment(null), false)
  assert.equal(isImageAttachment(undefined), false)
})

test('isAttachmentTooLarge: 5MB 上限，等于不算超', () => {
  assert.equal(ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024)
  assert.equal(isAttachmentTooLarge(0), false)
  assert.equal(isAttachmentTooLarge(ATTACHMENT_MAX_BYTES), false)
  assert.equal(isAttachmentTooLarge(ATTACHMENT_MAX_BYTES + 1), true)
})
