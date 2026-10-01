// 子任务附件的纯规则：类型判断 / 大小上限。与后端 SubtaskImage 上传限制（5MB）对齐。
// 纯模块（无 DOM / React 依赖），tests/unit/attachments.test.ts 直测。

/** 单个附件大小上限（字节），超过则在前端直接跳过不上传 */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024

/** 按 MIME 判断是否图片（缩略图展示）；非 image/* 一律当文档芯片展示 */
export function isImageAttachment(contentType: string | null | undefined): boolean {
  return typeof contentType === 'string' && /^image\//i.test(contentType.trim())
}

/** 是否超过上传上限（等于上限不算超） */
export function isAttachmentTooLarge(sizeBytes: number): boolean {
  return sizeBytes > ATTACHMENT_MAX_BYTES
}
