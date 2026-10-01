"""act 节点：只执行 guard 放行（L0/L1）或获批（approve/edit）的调用；reject → 拒绝 tool 消息。

- 执行前用同一个 needs_approval 再核对一次"该 callId 有 approve/edit 决策"，并用与 guard 共用的 card_expired
  核对确认卡 TTL（两道门共用判定：续跑/刷新后过期的审批不会被执行）。
- L0 并行执行（无副作用，中断后重跑即可）；写操作一次一个，且"先落标记再发请求"：标记 {phase: started, attempt}
  进 checkpoint 后（act→act 自环）才真正执行。运行被超时/异常打断后续跑时，看到的标记若不是本次 attempt 留下的，
  说明上次请求可能已发出且结果未知 → 不重发，回 UNKNOWN_OUTCOME 让用户核对（写操作不自动重试）。
- 后端 401 不算执行：记 phase=unauthorized 并路由到 reauth 节点 interrupt（token_expired）；刷新令牌后 resume，
  未受理的调用重新执行，已完成的不重放、也不重复 emit。
- 409 不生成 tool 消息（交给 observe 决定重出卡还是报错），但 tool_result{ok:false} 事件照发，前端据此收尾工具行。
"""
import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from langgraph.config import get_config
from langgraph.types import interrupt
from pydantic import BaseModel

from app.harness import tool_guard as tg
from app.harness.approval import card_expired
from app.harness.auth import RequestCtx, current_ctx
from app.harness.fallback import ERROR_TEXT, manual_path
from app.nodes._calls import last_tool_calls, parse_args, raw_args, target_ids, validation_message
from app.nodes._emit import emit
from app.schemas import ReauthInterrupt, ResultCard, to_wire
from app.settings import Settings
from app.state import AgentState
from app.tools._client import PmApiError, TokenExpired
from app.tools._resolve import NEXT_SPRINT_MISSING, Ambiguous, NotFound

REJECT_TEXT = "用户拒绝了 {name}，未执行，除非用户再次要求否则不要重发。"
# NotFound 按 code 追加页内助手可用的补救手段（MCP 端的对应表在 app/mcp/_exec.py::MCP_HINTS，两边不互串）
PAGE_HINTS = {NEXT_SPRINT_MISSING: "，可先 create_sprint"}
# edit 决策执行成功：固定模板告诉模型「参数已被用户改过」（评审 M5/X5：否则模型对比自己的 tool_call 参数发现
# 不一致就当成失败去补救——重发原值的卡或谎称未执行）。参数值包 <data>，模板文案固定。
EDITED_PREFIX = "用户在确认卡上把参数改为 "
EDITED_TEXT = EDITED_PREFIX + "{args} 后已执行，以下是结果；这是用户的最终意图，不要按原参数重发。\n{result}"

# pending_results[cid]["phase"]
PHASE_STARTED = "started"          # 已落标记、请求可能已发出
PHASE_UNAUTHORIZED = "unauthorized"  # 后端 401，未受理；reauth 后重新执行
PHASE_DONE = "done"


@dataclass
class CallResult:
    ok: bool
    status: int | None = None        # HTTP 状态（成功时 200；系统拒绝/异常时 None）
    code: str | None = None
    message: str | None = None
    data: Any = None
    decision: str = "none"           # approve/edit/reject/none
    ms: int = 0
    risk: str = "L0"
    tool: str = ""
    args: dict = field(default_factory=dict)
    user_rejected: bool = False

    def to_state(self) -> dict:
        """落 checkpoint 的完整结果（含 data：tool 消息在本轮全部完成后才统一生成）。"""
        return {"phase": PHASE_DONE, "ok": self.ok, "status": self.status, "code": self.code, "message": self.message,
                "decision": self.decision, "ms": self.ms, "risk": self.risk, "tool": self.tool, "args": self.args,
                "data": self.data, "user_rejected": self.user_rejected}

    @classmethod
    def from_state(cls, r: dict) -> "CallResult":
        return cls(ok=bool(r.get("ok")), status=r.get("status"), code=r.get("code"), message=r.get("message"),
                   data=r.get("data"), decision=r.get("decision", "none"), ms=int(r.get("ms") or 0),
                   risk=r.get("risk", "L0"), tool=r.get("tool", ""), args=dict(r.get("args") or {}),
                   user_rejected=bool(r.get("user_rejected")))


def data_block(data: Any) -> str:
    """用户数据包在 <data> 里：是数据不是指令（spec §7.3）。用户数据里的 "</data" 转成 JSON 合法的 "<\\/data"，
    标签不会被内容提前闭合，模型解析到的原文不变。"""
    payload = json.dumps(data, ensure_ascii=False, default=str).replace("</data", "<\\/data")
    return f"<data>{payload}</data>"


def is_ok_tool_content(content: Any) -> bool:
    """tool 消息是否为成功结果（前端历史的 ok 标记用）：<data> 开头，或 edit 决策的固定前缀。"""
    return isinstance(content, str) and (content.startswith("<data>") or content.startswith(EDITED_PREFIX))


def tool_data(content: Any) -> Any:
    """从 tool 消息内容里取出最后一段 <data>…</data> 的 JSON（成功结果）；不是成功结果 → None。"""
    if not is_ok_tool_content(content):
        return None
    start, end = content.rfind("<data>"), content.rfind("</data>")
    if start < 0 or end < start:
        return None
    try:
        return json.loads(content[start + len("<data>"):end])
    except ValueError:
        return None


def tool_message(call_id: str, r: CallResult) -> dict:
    if r.ok:
        content = data_block(r.data)
        if r.decision == "edit":
            content = EDITED_TEXT.format(args=data_block(r.args), result=content)
    elif r.user_rejected:
        content = REJECT_TEXT.format(name=r.tool)
    else:
        # 错误文案只放固定模板（_resolve 不把成员名/标题拼进 message）；候选等用户数据单独包进 <data>
        err: dict[str, Any] = {"code": r.code or "TOOL_ERROR", "message": r.message or ""}
        content = json.dumps({"error": err}, ensure_ascii=False)
        if r.data is not None:
            content += "\n" + data_block({"candidates": r.data})
    return {"role": "tool", "tool_call_id": call_id, "content": content}


def result_summary(spec: tg.ToolSpec, data: Any) -> str:
    if isinstance(data, dict):
        key, title = data.get("displayKey") or data.get("deleted"), data.get("title") or data.get("name")
        if key and title:
            return f"{key}「{title}」"
        if key:
            return str(key)
        for k in ("tasks", "hits", "members", "projects", "sprints", "epics", "items"):
            if isinstance(data.get(k), list):
                return f"{len(data[k])} 条"
        return spec.label
    if isinstance(data, list):
        return f"{len(data)} 条"
    return spec.label


def result_card(spec: tg.ToolSpec, data: Any, call_id: str = "", ctx: RequestCtx | None = None) -> dict | None:
    """L1 执行后的结果卡（schemas.ResultCard 的内部 dict；None 字段不带）。有展示号的任务/记录可撤销；path 为「打开」入口。"""
    if spec.risk != "L1":
        return None
    d = data if isinstance(data, dict) else {}
    key = d.get("displayKey")
    title = d.get("title") or d.get("name") or ""
    card = ResultCard(call_id=call_id, tool=spec.name, key=key, undoable=bool(key),
                      title=f"已创建 {key}「{title}」" if key else f"{spec.label}完成",
                      summary=result_summary(spec, data), path=manual_path(spec.name, ctx)[1] if ctx else None,
                      data=data)
    return card.model_dump(mode="json", exclude_none=True)


def current_attempt() -> str:
    """本次 HTTP 请求的 attempt（API 层写进 configurable）；图外/未配置时为空串。"""
    try:
        return str((get_config().get("configurable") or {}).get("attempt") or "")
    except RuntimeError:
        return ""


async def _execute(spec: tg.ToolSpec, args: BaseModel) -> CallResult:
    t0 = time.monotonic()
    try:
        data = await spec.fn(args)
        return CallResult(ok=True, status=200, data=data, ms=int((time.monotonic() - t0) * 1000))
    except TokenExpired:
        raise   # 401 由 act 记成 unauthorized 并转 reauth，不交给模型
    except PmApiError as exc:
        return CallResult(ok=False, status=exc.status, code=exc.code, message=exc.message,
                          ms=int((time.monotonic() - t0) * 1000))
    except NotFound as exc:
        return CallResult(ok=False, code=exc.code, message=exc.hinted(PAGE_HINTS),
                          ms=int((time.monotonic() - t0) * 1000))
    except Ambiguous as exc:
        return CallResult(ok=False, code="AMBIGUOUS", message=exc.message, data=exc.candidates,
                          ms=int((time.monotonic() - t0) * 1000))
    except Exception as exc:  # noqa: BLE001 —— 工具内部错误也要回给模型，不能让整轮崩掉
        return CallResult(ok=False, code="TOOL_ERROR", message=f"{type(exc).__name__}: {exc}"[:300],
                          ms=int((time.monotonic() - t0) * 1000))


def _plan(tc: dict, decisions: dict[str, dict], cards: dict[str, dict], ctx: RequestCtx,
          now: datetime) -> tuple[tg.ToolSpec | None, BaseModel | None, CallResult]:
    """执行前判定：返回 (spec, 待执行入参, 预置结果)；入参为 None 表示不执行，预置结果即最终结果。"""
    cid = tc.get("id")
    name = (tc.get("function") or {}).get("name", "")
    spec = tg.REGISTRY.get(name)
    if spec is None:
        return None, None, CallResult(ok=False, code="UNKNOWN_TOOL", message=f"工具 {name!r} 不存在", tool=name)
    d = decisions.get(cid)
    if d is not None and d.get("type") == "reject":
        if d.get("code"):  # 系统拒绝（参数无效/过期/不存在…）
            return spec, None, CallResult(ok=False, code=d["code"], message=d.get("message"), data=d.get("candidates"),
                                          decision="reject", tool=name, risk=spec.risk)
        return spec, None, CallResult(ok=False, code="USER_REJECTED", message=d.get("message"), decision="reject",
                                      tool=name, risk=spec.risk, user_rejected=True)
    try:
        args = parse_args(spec, raw_args(tc))
    except Exception as exc:  # noqa: BLE001
        return spec, None, CallResult(ok=False, code="INVALID_PARAMS", message=f"参数无效: {validation_message(exc)}",
                                      tool=name, risk=spec.risk)
    risk = tg.effective_risk(spec, args, ctx)
    if tg.needs_approval(risk):
        # 第二道门：L2/L3 必须有 approve/edit 决策，否则一律不执行（与 guard 共用 needs_approval）
        if d is None or d.get("type") not in ("approve", "edit"):
            return spec, None, CallResult(ok=False, code="MISSING_APPROVAL", message="该操作未获用户批准，未执行",
                                          tool=name, risk=risk)
        # 卡片 TTL：决策后中断、很久之后才续跑的审批不再有效（与 guard 共用 card_expired）
        card = cards.get(cid) or {}
        if card.get("expires_at") and card_expired(card["expires_at"], now):
            return spec, None, CallResult(ok=False, code="CARD_EXPIRED", message=ERROR_TEXT["CARD_EXPIRED"],
                                          decision=d.get("type", "none"), tool=name, risk=risk)
    if d is not None and d.get("type") == "edit":
        args = parse_args(spec, d.get("args") or {})
    return spec, args, CallResult(ok=True, decision=(d or {}).get("type", "none"), tool=name, risk=risk,
                                  args=args.model_dump(mode="json", exclude_unset=True))


def route_after_act(state: AgentState) -> str:
    return state.get("act_next") or "observe"


def make_reauth_node() -> Callable[[AgentState], Awaitable[dict]]:
    """后端 401：挂起等前端刷新令牌后原样重发（Command(resume=True)）；恢复后回 act 继续未执行的调用。"""
    async def reauth(state: AgentState) -> dict:
        interrupt(to_wire(ReauthInterrupt()))
        return {}

    return reauth


def make_act_node(settings: Settings, now_fn: Callable[[], datetime], audit=None) -> Callable[[AgentState], Awaitable[dict]]:
    async def act(state: AgentState) -> dict:
        ctx = current_ctx()
        now = now_fn()
        attempt = current_attempt()
        tool_calls = last_tool_calls(state.get("messages", []))
        targets = target_ids(state, tool_calls)
        by_id = {tc.get("id"): tc for tc in tool_calls}
        decisions = state.get("decisions") or {}
        cards = state.get("cards") or {}
        # 上一次 act 落下的结果；reauth 恢复后 unauthorized 的调用视为从未开始（后端未受理）
        results: dict[str, dict] = {cid: dict(r) for cid, r in (state.get("pending_results") or {}).items()
                                    if cid in targets and r.get("phase") != PHASE_UNAUTHORIZED}

        async def finish(cid: str, r: CallResult) -> None:
            results[cid] = r.to_state()
            if audit is not None:
                summary = r.message or (result_summary(tg.REGISTRY[r.tool], r.data) if r.tool in tg.REGISTRY else "")
                await audit.tool_call(state.get("run_id", ""), cid, r.tool, r.risk, r.args, r.decision, r.status,
                                      summary, r.ms)

        def emit_result(cid: str, spec: tg.ToolSpec, r: CallResult) -> None:
            ev: dict[str, Any] = {"type": "tool_result", "call_id": cid, "ok": r.ok}
            if r.ok:
                ev["summary"] = result_summary(spec, r.data)
                ev["data"] = r.data
            else:
                ev["code"], ev["message"] = r.code, r.message
            emit(ev)
            if r.ok and (card := result_card(spec, r.data, cid, ctx)):
                emit({"type": "result_card", "call_id": cid, "card": card})

        plans: dict[str, tuple[tg.ToolSpec, BaseModel, CallResult]] = {}
        for cid in targets:
            if results.get(cid, {}).get("phase") == PHASE_DONE:
                continue
            spec, args, pre = _plan(by_id[cid], decisions, cards, ctx, now)
            if args is None:
                await finish(cid, pre)
                # 出过确认卡、却被系统拒绝（INVALID_PARAMS / CARD_EXPIRED / INVALID_DECISION / MISSING_APPROVAL…）：
                # 前端已把卡标成「已确认/已提交修改」，必须告诉它这次没执行 → tool_result{ok:false}；用户自己取消的不发
                if spec is not None and cid in cards and not pre.user_rejected:
                    emit_result(cid, spec, pre)
            else:
                plans[cid] = (spec, args, pre)

        async def run_one(cid: str, spec: tg.ToolSpec, args: BaseModel, pre: CallResult) -> None:
            emit({"type": "tool_start", "call_id": cid, "tool": spec.name, "label": spec.label, "risk": pre.risk})
            try:
                r = await _execute(spec, args)
            except TokenExpired:
                results[cid] = {"phase": PHASE_UNAUTHORIZED, "tool": spec.name, "risk": pre.risk}
                return
            r.decision, r.risk, r.tool, r.args = pre.decision, pre.risk, spec.name, pre.args
            await finish(cid, r)
            emit_result(cid, spec, r)   # 409 也发 tool_result{ok:false}：tool 消息由 observe 决定（重出卡或报错）

        def unauthorized() -> bool:
            return any(r.get("phase") == PHASE_UNAUTHORIZED for r in results.values())

        # 只读并行：无副作用，不需要标记
        reads = [(cid, *plans[cid]) for cid in targets if cid in plans and plans[cid][2].risk == "L0"]
        if reads:
            await asyncio.gather(*(run_one(*x) for x in reads))
            if unauthorized():
                return {"pending_results": results, "act_next": "reauth"}

        # 写操作：一次一个；先落标记（checkpoint）再执行，每执行完一个再落一次
        for cid in targets:
            if cid not in plans or plans[cid][2].risk == "L0":
                continue
            spec, args, pre = plans[cid]
            marker = results.get(cid)
            if marker is None:
                results[cid] = {"phase": PHASE_STARTED, "attempt": attempt, "tool": spec.name, "risk": pre.risk}
                return {"pending_results": results, "act_next": "act"}
            if marker.get("attempt") != attempt:
                # 上次运行在发出请求前后被打断（超时/异常），结果未知：不重发，让用户核对
                emit({"type": "tool_start", "call_id": cid, "tool": spec.name, "label": spec.label, "risk": pre.risk})
                r = CallResult(ok=False, code="UNKNOWN_OUTCOME", message=ERROR_TEXT["UNKNOWN_OUTCOME"],
                               decision=pre.decision, risk=pre.risk, tool=spec.name, args=pre.args)
                await finish(cid, r)
                emit_result(cid, spec, r)
                continue
            await run_one(cid, spec, args, pre)
            return {"pending_results": results, "act_next": "reauth" if unauthorized() else "act"}

        msgs = [tool_message(cid, CallResult.from_state(results[cid])) for cid in targets
                if results.get(cid, {}).get("phase") == PHASE_DONE and results[cid].get("status") != 409]
        return {"messages": msgs, "pending_results": results, "act_next": "observe"}

    return act
