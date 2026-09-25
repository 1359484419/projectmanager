"""/assistant/threads 路由（spec §5.1）。请求/响应 JSON 为 camelCase，转换只经 schemas.to_wire/from_wire。

线程互斥：messages / resume 入口先 try_acquire 线程锁（harness.thread_lock），占用中直接 409 THREAD_BUSY；
锁在 SSE 流结束（含异常/断开）或校验失败抛错时释放。GET 不加锁。
"""
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from langgraph.types import Command
from pydantic import BaseModel, ValidationError

from app.api.deps import ApiError, gateway_ctx, new_thread_id, require_assistant, require_own_thread
from app.api.sse import (is_incomplete, new_run_input, pending_cards, reauth_pending, run_stream, sse_response,
                         thread_config)
from app.harness.auth import RequestCtx
from app.harness.thread_lock import ThreadLocks
from app.nodes.act import is_ok_tool_content
from app.schemas import Decision, ThreadCreated, ThreadSnapshot, from_wire, to_wire

router = APIRouter(prefix="/assistant/threads", dependencies=[Depends(require_assistant)])


class MessageIn(BaseModel):
    text: str


class ResumeIn(BaseModel):
    decisions: list[dict[str, Any]]


def simplify_messages(messages: list[dict]) -> list[dict]:
    """面向前端的简化历史（内部 snake_case，出口经 to_wire）：user/assistant 文本 + 工具调用结果（call_id/tool/ok）；
    system 与空 assistant 不出。"""
    tool_names: dict[str, str] = {}
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "user":
            out.append({"role": "user", "text": m.get("content") or ""})
        elif role == "assistant":
            for tc in m.get("tool_calls") or []:
                tool_names[tc.get("id", "")] = (tc.get("function") or {}).get("name", "")
            if m.get("content"):
                out.append({"role": "assistant", "text": m["content"]})
        elif role == "tool":
            cid = m.get("tool_call_id", "")
            out.append({"role": "tool", "call_id": cid, "tool": tool_names.get(cid, ""),
                        "ok": is_ok_tool_content(m.get("content") or "")})
    return out


def _parse_decisions(raw: list[dict], limit: int) -> dict[str, dict]:
    """前端 camelCase 决策 → callId → 内部 snake 决策；重复 callId → 400；超过条数上限 → 422。"""
    if len(raw) > limit:
        raise ApiError(422, "VALIDATION", f"decisions 最多 {limit} 条")
    parsed: dict[str, dict] = {}
    for d in raw:
        try:
            dec = Decision.model_validate(from_wire(d))
        except ValidationError as exc:
            raise ApiError(422, "INVALID_DECISION", f"决策格式无效: {exc.errors()[0].get('msg', '')}") from None
        if dec.call_id in parsed:
            raise ApiError(400, "DECISION_MISMATCH", f"决策 callId 重复: {dec.call_id}")
        parsed[dec.call_id] = dec.model_dump(exclude_none=True)
    return parsed


def _continue_input(st: Any) -> Any:
    """中断后的续跑输入：reauth 挂起 → Command(resume=True)；其它未完成 → None 原地续跑。"""
    return Command(resume=True) if reauth_pending(st) else None


def _acquire(locks: ThreadLocks, thread_id: str) -> None:
    if not locks.try_acquire(thread_id):
        raise ApiError(409, "THREAD_BUSY", "该会话正在处理上一条请求，请等它结束后再试")


async def _release_after(locks: ThreadLocks, thread_id: str, events: AsyncIterator[dict]) -> AsyncIterator[dict]:
    """事件流结束（正常/异常/客户端断开）即释放线程锁。"""
    try:
        async for ev in events:
            yield ev
    finally:
        locks.release(thread_id)


async def _message_events(state: Any, thread_id: str, text: str, ctx: RequestCtx) -> AsyncIterator[dict]:
    """messages 端点的校验 + 事件流构造（调用方已持有线程锁）。"""
    st = await state.graph.aget_state(thread_config(thread_id))
    cards = pending_cards(st)
    if cards:
        raise ApiError(409, "THREAD_PENDING", "有待确认的操作，请先处理确认卡", pending_cards=cards)
    values = st.values or {}
    if reauth_pending(st) or is_incomplete(st):
        # 上一次运行中断（超时/模型不可用/登录过期）：同一句话重发 = 原地续跑；换了话 → 先让前端重试/放弃
        last_user = next((m for m in reversed(values.get("messages") or []) if m.get("role") == "user"), None)
        if last_user and (last_user.get("content") or "").strip() == text:
            return run_stream(graph=state.graph, settings=state.settings, audit=state.audit, ctx=ctx,
                              thread_id=thread_id, run_id=values.get("run_id") or uuid.uuid4().hex,
                              inp=_continue_input(st))
        raise ApiError(409, "THREAD_PENDING", "上一次操作未完成：重发同一条消息可继续，或新开会话", pending_cards=[])
    run_id = uuid.uuid4().hex
    if state.audit is not None:
        await state.audit.start_run(run_id, thread_id, ctx.tenant, ctx.user_id, text)
    return run_stream(graph=state.graph, settings=state.settings, audit=state.audit, ctx=ctx,
                      thread_id=thread_id, run_id=run_id, inp=new_run_input(text, run_id))


async def _resume_events(state: Any, thread_id: str, raw_decisions: list[dict], ctx: RequestCtx) -> AsyncIterator[dict]:
    """resume 端点的校验 + 事件流构造（调用方已持有线程锁）。"""
    st = await state.graph.aget_state(thread_config(thread_id))
    values = st.values or {}
    cards = pending_cards(st)
    decisions = _parse_decisions(raw_decisions, state.settings.max_decisions_per_resume)
    if not cards:
        submitted = set((values.get("decisions") or {}).keys())
        if decisions and (reauth_pending(st) or is_incomplete(st)) and set(decisions) <= submitted:
            # 已提交过决策、执行阶段中断（如 401）：刷新后原样重发 → 续跑；已完成的写操作由 act 的 checkpoint 保证不重放
            return run_stream(graph=state.graph, settings=state.settings, audit=state.audit, ctx=ctx,
                              thread_id=thread_id, run_id=values.get("run_id") or uuid.uuid4().hex,
                              inp=_continue_input(st))
        raise ApiError(400, "NO_PENDING_CARDS", "当前没有待确认的操作")
    expected = [c["callId"] for c in cards]
    if set(decisions) != set(expected):
        raise ApiError(400, "DECISION_MISMATCH",
                       f"决策与挂起的确认卡不符：需要 {expected}，收到 {sorted(decisions)}")
    first = decisions.pop(expected[0])
    return run_stream(graph=state.graph, settings=state.settings, audit=state.audit, ctx=ctx,
                      thread_id=thread_id, run_id=values.get("run_id") or uuid.uuid4().hex,
                      inp=Command(resume=first), decisions=decisions)


@router.post("")
async def create_thread(ctx: RequestCtx = Depends(gateway_ctx)) -> dict:
    return to_wire(ThreadCreated(thread_id=new_thread_id(ctx)))


@router.get("/{thread_id}")
async def get_thread(thread_id: str, request: Request, ctx: RequestCtx = Depends(gateway_ctx)) -> dict:
    require_own_thread(thread_id, ctx)
    st = await request.app.state.graph.aget_state(thread_config(thread_id))
    # pending_cards 已是线上形态；simplify_messages 的 call_id 在这里一并转 camel
    return to_wire(ThreadSnapshot(thread_id=thread_id, messages=simplify_messages((st.values or {}).get("messages") or []),
                                  pending_cards=pending_cards(st)))


@router.post("/{thread_id}/messages")
async def post_message(thread_id: str, body: MessageIn, request: Request, ctx: RequestCtx = Depends(gateway_ctx)):
    require_own_thread(thread_id, ctx)
    state = request.app.state
    text = body.text.strip()
    if not text:
        raise ApiError(400, "VALIDATION", "text 不能为空")
    if len(text) > state.settings.max_message_chars:
        raise ApiError(422, "VALIDATION", f"text 最多 {state.settings.max_message_chars} 字")
    locks: ThreadLocks = state.thread_locks
    _acquire(locks, thread_id)
    try:
        events = await _message_events(state, thread_id, text, ctx)
    except BaseException:
        locks.release(thread_id)
        raise
    return sse_response(_release_after(locks, thread_id, events), state.settings)


@router.post("/{thread_id}/resume")
async def resume_thread(thread_id: str, body: ResumeIn, request: Request, ctx: RequestCtx = Depends(gateway_ctx)):
    require_own_thread(thread_id, ctx)
    state = request.app.state
    locks: ThreadLocks = state.thread_locks
    _acquire(locks, thread_id)
    try:
        events = await _resume_events(state, thread_id, body.decisions, ctx)
    except BaseException:
        locks.release(thread_id)
        raise
    return sse_response(_release_after(locks, thread_id, events), state.settings)
