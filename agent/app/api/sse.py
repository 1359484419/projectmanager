"""图执行 → SSE 事件流。

- 用 graph.astream(stream_mode=["updates","custom"])：custom 是节点用 get_stream_writer 发的、已 to_wire 的事件
  （text_delta / tool_start / tool_result / result_card）；updates 里的 "__interrupt__" 转成 confirm
  （确认卡：本轮全部卡一次发完再停流）或 error{TOKEN_EXPIRED}（reauth 节点），"observe" 里的 error 转成 error 事件，
  结束时补 done{usage}。
- 一次请求的墙钟上限 settings.run_timeout_seconds → error{ASSISTANT_TIMEOUT}。
- 异常分类：StreamInterrupted → STREAM_INTERRUPTED；TokenExpired → TOKEN_EXPIRED；openai 错误 → LLM_UNAVAILABLE；
  其它 → ASSISTANT_ERROR。错误只会出现一次且是最后一个事件；出错后不发 done。
- 审计：start_run 由 messages 端点调用，end_run 在流结束时按 ok / interrupted / error 记录。
"""
import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import openai
from langgraph.types import Command
from sse_starlette.sse import EventSourceResponse, ServerSentEvent

from app.harness.audit import Audit
from app.harness.auth import RequestCtx, reset_ctx, set_ctx
from app.harness.fallback import error_event
from app.llm import StreamInterrupted
from app.schemas import Card, SseEvent, Usage, to_wire
from app.settings import Settings
from app.tools._client import TokenExpired

log = logging.getLogger("pm.agent.sse")


def thread_config(thread_id: str, attempt: str | None = None) -> dict:
    """attempt = 本次 HTTP 请求的标识：act 用它区分"本次落的执行标记"与"上次中断遗留的标记"（后者不重发）。"""
    conf: dict[str, Any] = {"thread_id": thread_id}
    if attempt:
        conf["attempt"] = attempt
    return {"configurable": conf}


def new_run_input(text: str, run_id: str) -> dict:
    """一次新运行的初始状态：messages 追加（reducer），其余按运行重置。"""
    return {"messages": [{"role": "user", "content": text}], "round": 0, "tokens_used": 0,
            "prompt_tokens": 0, "completion_tokens": 0, "decisions": {}, "cards": {}, "run_id": run_id,
            "conflict_retries": {}, "last_call_sigs": [], "pending_call_ids": [], "pending_results": {},
            "act_next": "", "invalid_param_counts": {}, "error": None, "route": ""}


def _interrupt_value(snapshot: Any) -> dict:
    intrs = getattr(snapshot, "interrupts", None) or ()
    v = getattr(intrs[0], "value", None) if intrs else None
    return v if isinstance(v, dict) else {}


def reauth_pending(snapshot: Any) -> bool:
    """在 reauth 节点挂起（后端 401）：前端刷新令牌后原样重发即可续跑，不是确认卡。"""
    return _interrupt_value(snapshot).get("type") == "token_expired"


def pending_cards(snapshot: Any) -> list[dict]:
    """挂起中的确认卡（camelCase）：从当前 interrupt 的那张起、按 pending_call_ids 顺序取本轮全部。

    判定只看 StateSnapshot.interrupts（同一节点第二次 interrupt 时 next 为空，不可靠）。
    """
    value = _interrupt_value(snapshot)
    if not value or "callId" not in value:
        return []
    current = value.get("callId")
    values = snapshot.values or {}
    cards = values.get("cards") or {}
    order = [cid for cid in (values.get("pending_call_ids") or []) if cid in cards]
    if current in order:
        order = order[order.index(current):]
    elif current in cards:
        order = [current]
    return [to_wire(Card.model_validate(cards[cid])) for cid in order]


def is_incomplete(snapshot: Any) -> bool:
    """上一次运行没跑完（超时/模型不可用/401 中断），且不是在等确认卡：可用 None 输入原地续跑。"""
    return bool(getattr(snapshot, "next", ())) and not getattr(snapshot, "interrupts", None)


def _classify(exc: BaseException) -> tuple[str, str | None]:
    """异常 → (错误码, 附加文案)。"""
    if isinstance(exc, StreamInterrupted):
        return "STREAM_INTERRUPTED", None
    if isinstance(exc, TokenExpired):
        return "TOKEN_EXPIRED", None
    if isinstance(exc, openai.OpenAIError):
        return "LLM_UNAVAILABLE", None
    return "ASSISTANT_ERROR", None


@dataclass
class RunOutcome:
    interrupted: bool = False
    error_code: str | None = None
    last_tool: str | None = None
    usage: Usage = field(default_factory=Usage)

    @property
    def status(self) -> str:
        if self.error_code:
            return "error"
        return "interrupted" if self.interrupted else "ok"


async def graph_events(graph: Any, settings: Settings, ctx: RequestCtx, thread_id: str, inp: Any,
                       outcome: RunOutcome, attempt: str) -> AsyncIterator[dict]:
    """跑一段图（新输入 / Command(resume) / None 续跑），产出 camelCase 事件；结果写入 outcome。

    confirm 事件一定是最后一个（interrupt 即停流）；error 事件也一定是最后一个。
    """
    limit_error: dict | None = None
    try:
        async with asyncio.timeout(settings.run_timeout_seconds):
            async for mode, chunk in graph.astream(inp, thread_config(thread_id, attempt),
                                                   stream_mode=["updates", "custom"]):
                if mode == "custom":
                    if isinstance(chunk, dict):
                        if chunk.get("type") == "tool_start":
                            outcome.last_tool = chunk.get("tool")
                        yield chunk
                    continue
                if not isinstance(chunk, dict):
                    continue
                if "__interrupt__" in chunk:
                    for intr in chunk["__interrupt__"] or ():
                        value = getattr(intr, "value", intr)
                        if not isinstance(value, dict):
                            continue
                        if value.get("type") == "token_expired":
                            # reauth 节点：让前端刷新令牌后原样重发；已完成的写操作不会重放（act 逐调用落 checkpoint）
                            outcome.error_code = "TOKEN_EXPIRED"
                            yield to_wire(error_event("TOKEN_EXPIRED", ctx, tool=outcome.last_tool))
                            return
                        outcome.interrupted = True
                        yield to_wire({"type": "confirm", "call_id": value.get("callId"), "card": value})
                    continue
                observe = chunk.get("observe")
                if isinstance(observe, dict) and observe.get("error"):
                    limit_error = observe["error"]
    except TimeoutError:
        outcome.error_code = "ASSISTANT_TIMEOUT"
        yield to_wire(error_event("ASSISTANT_TIMEOUT", ctx, tool=outcome.last_tool))
        return
    except Exception as exc:  # noqa: BLE001 —— 分类后转成 error 事件，流必须正常结束
        code, msg = _classify(exc)
        outcome.error_code = code
        log.exception("run failed thread=%s code=%s", thread_id, code)
        yield to_wire(error_event(code, ctx, tool=outcome.last_tool, message=msg))
        return

    if limit_error:
        outcome.error_code = limit_error.get("code") or "ASSISTANT_ERROR"
        yield to_wire(error_event(outcome.error_code, ctx, tool=outcome.last_tool, message=limit_error.get("message")))


async def _final_usage(graph: Any, thread_id: str) -> Usage:
    st = await graph.aget_state(thread_config(thread_id))
    values = st.values or {}
    return Usage(prompt_tokens=int(values.get("prompt_tokens", 0) or 0),
                 completion_tokens=int(values.get("completion_tokens", 0) or 0))


async def run_stream(*, graph: Any, settings: Settings, audit: Audit | None, ctx: RequestCtx, thread_id: str,
                     run_id: str, inp: Any, decisions: dict[str, dict] | None = None) -> AsyncIterator[dict]:
    """一次 HTTP 请求对应的完整事件流。

    inp：新运行的初始状态 / None（续跑）/ Command(resume=…)。decisions（callId → 内部 snake 决策）非空时为 resume：
    逐张按 interrupt 顺序提交；图对某张卡再次挂起（如 409 重出卡）而我们没有它的决策 → 发 confirm 结束。
    """
    token = set_ctx(ctx)
    outcome = RunOutcome()
    remaining = dict(decisions or {})
    attempt = uuid.uuid4().hex
    try:
        current = inp
        while True:
            outcome.interrupted = False
            pending_confirm: dict | None = None
            # 不能 break：遗弃的异步生成器会延后关闭，LangGraph 的 checkpoint 收尾（写 interrupt）就会晚于下一个请求
            async for ev in graph_events(graph, settings, ctx, thread_id, current, outcome, attempt):
                if ev.get("type") == "confirm":
                    pending_confirm = ev   # interrupt 即停流，confirm 一定是最后一个事件
                    continue
                yield ev
            if pending_confirm is None:
                break
            cid = pending_confirm.get("callId")
            if cid in remaining:
                current = Command(resume=remaining.pop(cid))
                continue
            # 图逐张 interrupt，但对外一次发出本轮全部挂起卡（从当前这张起）：前端收齐后一并提交决策（spec §6.2）
            cards = pending_cards(await graph.aget_state(thread_config(thread_id))) or [pending_confirm["card"]]
            for card in cards:
                yield to_wire({"type": "confirm", "call_id": card.get("callId"), "card": card})
            break
        if not outcome.interrupted and not outcome.error_code:
            outcome.usage = await _final_usage(graph, thread_id)
            yield to_wire(SseEvent(type="done", usage=outcome.usage))
    finally:
        if audit is not None:
            try:
                tokens = outcome.usage.prompt_tokens + outcome.usage.completion_tokens
                if not tokens:
                    u = await _final_usage(graph, thread_id)
                    tokens = u.prompt_tokens + u.completion_tokens
                await audit.end_run(run_id, outcome.status, tokens, outcome.error_code)
            except Exception:  # noqa: BLE001 —— 审计失败不影响响应
                log.exception("audit end_run failed run=%s", run_id)
        reset_ctx(token)


def sse_response(events: AsyncIterator[dict], settings: Settings) -> EventSourceResponse:
    """每个事件一行 `data: <json>\\n\\n`；settings.sse_ping_seconds 一次注释行 ping 保活（Java 反代/浏览器不会因模型思考太久断开）。"""
    async def _encode():
        async for ev in events:
            yield ServerSentEvent(data=json.dumps(ev, ensure_ascii=False, default=str), sep="\n")

    return EventSourceResponse(_encode(), sep="\n", ping=settings.sse_ping_seconds,
                               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
