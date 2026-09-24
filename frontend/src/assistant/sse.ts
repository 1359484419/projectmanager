// SSE 客户端：把 fetch Response 的字节流切成事件。
// 协议：每个事件 `data: <json>\n\n`；反代按块 flush，块边界不对齐事件，所以要做缓冲拼接。
// 用 TextDecoder 的 stream 模式，避免多字节字符跨块被切坏。
import type { SseEvent } from './types'

/** 把一段完整的事件文本（不含结尾空行）解析成事件；无 data 或非法 JSON 返回 null */
export function parseSseBlock(block: string): SseEvent | null {
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith(':')) continue // 注释 / keep-alive
    if (!line.startsWith('data:')) continue // event:/id: 等本协议不用
    dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  const data = dataLines.join('\n').trim()
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as SseEvent
    return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** 逐事件产出；流结束时缓冲区里没有结尾空行的残留事件也交付 */
export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // 按空行切：\n\n 或 \r\n\r\n
      let idx: number
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
        const ev = parseSseBlock(block)
        if (ev) yield ev
      }
    }
    buf += decoder.decode()
    const tail = parseSseBlock(buf)
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}
