"""线程互斥（harness）：同一 thread_id 同时只允许一个运行（messages / resume），第二个请求直接 409 THREAD_BUSY。

- 为什么需要：resume/messages 的「aget_state → 校验挂起卡 → 跑图」不是原子的，两条相同的 resume 并发到达时都会通过
  校验并各自执行写操作（spec §7.2「approve 后发且仅发一次」不能只靠前端按钮置灰）。
- 单 uvicorn 进程（deploy/pm-agent.service 不开 workers）：asyncio 单线程，try_acquire 内无 await，天然原子。
  多进程/多实例部署需换成 PG advisory lock（pg_try_advisory_xact_lock(hashtext(thread_id))）。
- 释放时机：SSE 流结束（含异常/客户端断开）由 API 层在生成器 finally 里释放；校验失败提前抛错时同样释放。
"""


class ThreadLocks:
    def __init__(self) -> None:
        self._held: set[str] = set()

    def try_acquire(self, thread_id: str) -> bool:
        """非阻塞：占到返回 True；已被占用返回 False（调用方 409）。"""
        if thread_id in self._held:
            return False
        self._held.add(thread_id)
        return True

    def release(self, thread_id: str) -> None:
        self._held.discard(thread_id)

    def held(self, thread_id: str) -> bool:
        return thread_id in self._held
