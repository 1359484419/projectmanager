"""observe 节点：409 冲突判定（回 guard 重出卡，最多一次）、同参重复检测、参数无效自纠上限、轮数/token 上限；决定路由。

阈值全部来自 settings（repeat_call_limit / call_sig_window / max_invalid_param_retries / max_tool_rounds / max_tokens_per_run）。

409 的处理（spec §7.5、全局约束「写操作不自动重试」）：只有「乐观锁冲突」才回 prepare 重出卡——status=409 且
code=CONFLICT 且该 callId 本轮出过确认卡（L2/L3）。其它 409（业务规则：ACTIVE_SPRINT_EXISTS / LAST_ADMIN …）
以及没出过卡的 L1 409 一律不重发，直接生成带原错误码的 tool 消息交给模型汇报。
"""
from collections.abc import Awaitable, Callable

from app.harness.fallback import ERROR_TEXT
from app.harness.limiter import call_signature, is_repeating, over_limits
from app.nodes._calls import last_tool_calls, raw_args, target_ids
from app.nodes.act import CallResult, tool_message
from app.settings import Settings
from app.state import AgentState

CONFLICT_CODE = "CONFLICT"   # Java tasks.version 乐观锁冲突的错误码（GlobalExceptionHandler）


def is_optimistic_conflict(call_id: str, result: dict, cards: dict) -> bool:
    """可重出卡的冲突：409 + code=CONFLICT + 该调用出过确认卡。"""
    return result.get("status") == 409 and result.get("code") == CONFLICT_CODE and call_id in cards


def make_observe_node(settings: Settings) -> Callable[[AgentState], Awaitable[dict]]:
    async def observe(state: AgentState) -> dict:
        tool_calls = last_tool_calls(state.get("messages", []))
        targets = target_ids(state, tool_calls)
        results = state.get("pending_results") or {}
        cards = state.get("cards") or {}
        retries = dict(state.get("conflict_retries") or {})
        msgs: list[dict] = []
        conflicts: list[str] = []
        for cid in targets:
            r = results.get(cid) or {}
            if r.get("status") != 409:
                continue
            if is_optimistic_conflict(cid, r, cards) and retries.get(cid, 0) < 1:
                retries[cid] = retries.get(cid, 0) + 1
                conflicts.append(cid)
            else:
                # 业务规则 409 / 无卡的 L1 409 / 第二次冲突：原错误码交给模型，不再重发
                msgs.append(tool_message(cid, CallResult.from_state(r)))
        if conflicts:
            return {"conflict_retries": retries, "pending_call_ids": conflicts, "messages": msgs, "route": "guard",
                    "pending_results": {}}

        # 参数无效自纠计数（按工具）：超过上限就不再让模型继续烧轮数
        invalid = dict(state.get("invalid_param_counts") or {})
        for cid in targets:
            r = results.get(cid) or {}
            if r.get("code") == "INVALID_PARAMS":
                tool = r.get("tool") or "?"
                invalid[tool] = invalid.get(tool, 0) + 1
        invalid_over = any(n > settings.max_invalid_param_retries for n in invalid.values())

        # 循环检测：只统计首次执行的调用（409 重做不重复计数）
        sigs = list(state.get("last_call_sigs") or [])
        repeated = False
        for tc in tool_calls:
            if tc.get("id") not in targets or retries.get(tc.get("id"), 0):
                continue
            try:
                sig = call_signature((tc.get("function") or {}).get("name", ""), raw_args(tc))
            except ValueError:
                continue
            if is_repeating(sigs, sig, settings.repeat_call_limit):
                repeated = True
            sigs.append(sig)
        sigs = sigs[-settings.call_sig_window:]

        error = None
        if repeated:
            error = {"code": "REPEATED_CALLS", "message": ERROR_TEXT["REPEATED_CALLS"]}
        elif invalid_over:
            error = {"code": "INVALID_PARAMS", "message": ERROR_TEXT["INVALID_PARAMS"]}
        elif code := over_limits(state, settings):
            error = {"code": code, "message": ERROR_TEXT[code]}
        if error:
            msgs.append({"role": "assistant", "content": error["message"]})
            return {"conflict_retries": retries, "last_call_sigs": sigs, "messages": msgs, "route": "end",
                    "error": error, "pending_results": {}, "invalid_param_counts": invalid}
        return {"conflict_retries": retries, "last_call_sigs": sigs, "messages": msgs, "route": "reason",
                "pending_results": {}, "invalid_param_counts": invalid}

    return observe
