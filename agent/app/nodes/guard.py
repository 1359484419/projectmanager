"""审批两步：prepare 节点读现状生成确认卡（结果落 checkpoint）→ guard 节点 interrupt() 等人决策并校验。

- 拆成两个节点的原因：interrupt 恢复后所在节点整体重跑；若卡片在同一节点里生成，重跑会重新 GET 现状并
  重算 expires_at，过期判定失效、现状也可能与用户看到的不一致。prepare 的输出先被 checkpoint，guard 重跑只读它。
- 决策只认 LangGraph resume 传入的值；模型文本、state 里预埋的 decisions 一律无效（prepare 每轮重算并覆盖）。
- 每张卡一次 interrupt，按顺序恢复；任何一张未决策前不会进入 act。
- confirm 事件不在这里 emit（重跑会重复发），由 API 层从 interrupt payload 转成 SSE confirm。
"""
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

from langgraph.types import interrupt

from app.harness import tool_guard as tg
from app.harness.approval import build_card, card_expired
from app.harness.auth import current_ctx
from app.nodes._calls import last_tool_calls, parse_args, raw_args, target_ids, validation_message
from app.nodes.act import PAGE_HINTS
from app.schemas import Card, to_wire
from app.settings import Settings
from app.state import AgentState
from app.tools._client import PmApiError, TokenExpired
from app.tools._resolve import Ambiguous, NotFound

CONFLICT_NOTE = "对象已被他人修改，请再次确认"


def _system_reject(code: str, message: str) -> dict:
    """系统性拒绝（非用户决策）：带 code，act 会转成错误结果回给模型。"""
    return {"type": "reject", "code": code, "message": message}


def validate_decision(raw: Any, card: Card, spec: tg.ToolSpec, now: datetime) -> dict:
    """resume 值 → 规范化决策。过期 / 类型不允许 / edit 改了不可编辑字段 / edit 后参数无效 → 系统拒绝。"""
    if card_expired(card.expires_at, now):
        return _system_reject("CARD_EXPIRED", "确认卡已过期（超过有效期），未执行；请重新发起")
    if not isinstance(raw, dict):
        return _system_reject("INVALID_DECISION", "决策格式无效")
    dtype = raw.get("type")
    if dtype not in card.allowed_decisions:
        return _system_reject("INVALID_DECISION", f"决策 {dtype!r} 不在允许范围 {card.allowed_decisions}")
    cid = raw.get("call_id")
    if cid is not None and cid != card.call_id:
        return _system_reject("INVALID_DECISION", f"决策的 callId {cid!r} 与卡片不符")
    if dtype == "approve":
        return {"type": "approve"}
    if dtype == "reject":
        return {"type": "reject", "message": raw.get("message")}
    edits = raw.get("args") or {}
    if not isinstance(edits, dict):
        return _system_reject("INVALID_DECISION", "edit 的 args 必须是对象")
    # 前端会把整张卡的 args（含定位字段）连同改动一起回传：非 editable 的键只要与卡上原值（或参数缺省值）相同就不算越权
    defaults = {k: f.default for k, f in spec.params.model_fields.items() if not f.is_required()}
    base = {**defaults, **card.args}
    bad = sorted(k for k, v in edits.items() if k not in spec.editable and not (k in base and base[k] == v))
    if bad:
        return _system_reject("INVALID_DECISION", f"字段 {'、'.join(bad)} 不可编辑（可编辑：{'、'.join(spec.editable)}）")
    merged = {**card.args, **{k: v for k, v in edits.items() if k in spec.editable}}
    try:
        parsed = parse_args(spec, merged)
    except Exception as exc:  # noqa: BLE001 —— 回给模型/用户的是文案
        return _system_reject("INVALID_PARAMS", f"修改后的参数无效: {validation_message(exc)}")
    return {"type": "edit", "args": parsed.model_dump(mode="json", exclude_unset=True)}


def make_prepare_node(settings: Settings, now_fn: Callable[[], datetime]) -> Callable[[AgentState], Awaitable[dict]]:
    """解析入参、分级；L2/L3 读现状生成卡片。只做 GET，无副作用。"""
    async def prepare(state: AgentState) -> dict:
        ctx = current_ctx()
        tool_calls = last_tool_calls(state.get("messages", []))
        targets = target_ids(state, tool_calls)
        conflict_retries = state.get("conflict_retries") or {}
        decisions: dict[str, dict] = {}
        cards: dict[str, dict] = {}
        for tc in tool_calls:
            cid = tc.get("id")
            if cid not in targets:
                continue
            name = (tc.get("function") or {}).get("name", "")
            spec = tg.REGISTRY.get(name)
            if spec is None:
                decisions[cid] = _system_reject("UNKNOWN_TOOL", f"工具 {name!r} 不存在")
                continue
            try:
                args = parse_args(spec, raw_args(tc))
            except Exception as exc:  # noqa: BLE001
                decisions[cid] = _system_reject("INVALID_PARAMS", f"参数无效: {validation_message(exc)}")
                continue
            risk = tg.effective_risk(spec, args, ctx)
            if not tg.needs_approval(risk):
                continue  # L0/L1：无需决策；act 用同一 needs_approval 再核对一次
            note = CONFLICT_NOTE if conflict_retries.get(cid) else None
            try:
                card = await build_card(spec, args, cid, ctx, now_fn(), settings.card_ttl_seconds, note=note, risk=risk)
            except NotFound as exc:
                decisions[cid] = _system_reject(exc.code, exc.hinted(PAGE_HINTS))
                continue
            except Ambiguous as exc:
                decisions[cid] = {**_system_reject("AMBIGUOUS", exc.message), "candidates": exc.candidates}
                continue
            except TokenExpired:
                raise   # 401 穿透到 API 层（TOKEN_EXPIRED），不出卡也不交给模型
            except PmApiError as exc:
                decisions[cid] = _system_reject(exc.code, exc.message)
                continue
            cards[cid] = card.model_dump(mode="json")
        # decisions/cards 覆盖式写入：上一轮或外部塞进来的决策在这里作废
        return {"decisions": decisions, "cards": cards, "pending_call_ids": targets}

    return prepare


def make_guard_node(settings: Settings, now_fn: Callable[[], datetime]) -> Callable[[AgentState], Awaitable[dict]]:
    """对本轮每张卡 interrupt() 一次；恢复后本节点重跑，已恢复过的 interrupt 直接返回决策值。"""
    async def guard(state: AgentState) -> dict:
        cards = state.get("cards") or {}
        decisions = dict(state.get("decisions") or {})
        for cid in state.get("pending_call_ids") or []:
            raw_card = cards.get(cid)
            if raw_card is None:
                continue
            card = Card.model_validate(raw_card)
            spec = tg.REGISTRY[card.tool]
            raw = interrupt(to_wire(card))
            decisions[cid] = validate_decision(raw, card, spec, now_fn())
        return {"decisions": decisions}

    return guard
