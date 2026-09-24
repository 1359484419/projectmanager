// 单测：助手 SSE 客户端 readSse——按 "\n\n" 切事件、解析 data: 行，
// 事件被 TCP 分片切成两半时必须拼回来（Java 反代按块 flush，边界不对齐事件）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSse } from '../../src/assistant/sse.ts'
import type { SseEvent } from '../../src/assistant/types.ts'

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect(res: Response): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const ev of readSse(res)) out.push(ev)
  return out
}

test('readSse: 单块内多个事件按空行切分', async () => {
  const events = await collect(
    streamOf(['data: {"type":"text_delta","text":"你好"}\n\ndata: {"type":"done","usage":{"promptTokens":1,"completionTokens":2}}\n\n']),
  )
  assert.deepEqual(events, [
    { type: 'text_delta', text: '你好' },
    { type: 'done', usage: { promptTokens: 1, completionTokens: 2 } },
  ])
})

test('readSse: 事件跨 chunk 被切成两半仍能拼回', async () => {
  const events = await collect(
    streamOf([
      'data: {"type":"tool_start","callId":"c1","tool":"list_my_tasks","la',
      'bel":"查询我的任务","risk":"L0"}\n\ndata: {"type":"text_d',
      'elta","text":"好"}\n\n',
    ]),
  )
  assert.deepEqual(events, [
    { type: 'tool_start', callId: 'c1', tool: 'list_my_tasks', label: '查询我的任务', risk: 'L0' },
    { type: 'text_delta', text: '好' },
  ])
})

test('readSse: 多字节 UTF-8 字符跨 chunk 边界不乱码', async () => {
  const enc = new TextEncoder()
  const full = enc.encode('data: {"type":"text_delta","text":"跬步千里"}\n\n')
  // 在「跬」的第二个字节处切开
  const cut = 'data: {"type":"text_delta","text":"'.length + 1
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(full.slice(0, cut))
      controller.enqueue(full.slice(cut))
      controller.close()
    },
  })
  const events = await collect(new Response(body))
  assert.deepEqual(events, [{ type: 'text_delta', text: '跬步千里' }])
})

test('readSse: 忽略注释行/空 data，流结束时残留的无换行事件也交付', async () => {
  const events = await collect(
    streamOf([': keep-alive\n\ndata: \n\nevent: x\ndata: {"type":"text_delta","text":"a"}\n\ndata: {"type":"text_delta","text":"b"}']),
  )
  assert.deepEqual(events, [
    { type: 'text_delta', text: 'a' },
    { type: 'text_delta', text: 'b' },
  ])
})

test('readSse: 同一事件多行 data 用换行拼接', async () => {
  const events = await collect(streamOf(['data: {"type":"text_delta",\ndata: "text":"多行"}\n\n']))
  assert.deepEqual(events, [{ type: 'text_delta', text: '多行' }])
})

test('readSse: 无 body 的响应直接结束', async () => {
  const events = await collect(new Response(null))
  assert.deepEqual(events, [])
})
