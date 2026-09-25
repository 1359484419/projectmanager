"""observe 节点：409 冲突判定（回 guard 重出卡，最多一次）、同参重复检测、参数无效自纠上限、轮数/token 上限；决定路由。

阈值全部来自 settings（repeat_call_limit / call_sig_window / max_invalid_param_retries / max_tool_rounds / max_tokens_per_run）。

409 的处理（spec §7.5、全局约束「写操作不自动重试」）：只有「乐观锁冲突」才回 prepare 重出卡——status=409 且
code=CONFLICT 且该 callId 本轮出过确认卡（L2/L3）。其它 409（业务规则：ACTIVE_SPRINT_EXISTS / LAST_ADMIN …）
以及没出过卡的 L1 409 一律不重发，直接生成带原错误码的 tool 消息交给模型汇报。

观测（评审 2026-09-25 R1）：同一次运行里 create_X 之后紧跟 delete_X 同一对象（模型为占位/试探而创建再删除）
→ 结构化日志 + 审计 runs.flags 记 CREATE_THEN_DELETE:<delete 工具>:<对象>。不拦截（删除已经过确认卡）。
"""
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.harness.fallback import ERROR_TEXT
from app.harness.limiter import call_signature, is_repeating, over_limits
from app.nodes._calls import last_tool_calls, raw_args, target_ids
from app.nodes.act import CallResult, tool_data, tool_message
from app.settings import Settings
from app.state import AgentState

log = logging.getLogger("pm.agent.observe")

CONFLICT_CODE = "CONFLICT"   # Java tasks.version 乐观锁冲突的错误码（GlobalExceptionHandler）
FLAG_CREATE_THEN_DELETE = "CREATE_THEN_DELETE"


def _same_task(c_args: dict, c_data: Any, d_args: dict) -> str | None:
    key = (c_data or {}).get("displayKey") if isinstance(c_data, dict) else None
    return key if key and key == d_args.get("task_key") else None


def _same_subtask(c_args: dict, c_data: Any, d_args: dict) -> str | None:
    if c_args.get("task_key") == d_args.get("task_key") and c_args.get("title") == d_args.get("subtask_title"):
        return f"{d_args.get('task_key')}/{d_args.get('subtask_title')}"
    return None


def _same_epic(c_args: dict, c_data: Any, d_args: dict) -> str | None:
    return d_args.get("epic_name") if c_args.get("name") == d_args.get("epic_name") else None


def _same_sprint(c_args: dict, c_data: Any, d_args: dict) -> str | None:
    name = (c_data or {}).get("name") if isinstance(c_data, dict) else None
    return name if name and name == d_args.get("sprint_name") else None


# delete 工具 → (对应的 create 工具, 同对象判定：返回对象标识或 None)
_CREATE_OF_DELETE: dict[str, tuple[str, Callable[[dict, Any, dict], str | None]]] = {
    "delete_task": ("create_task", _same_task),
    "delete_subtask": ("create_subtask", _same_subtask),
    "delete_epic": ("create_epic", _same_epic),
    "delete_sprint": ("create_sprint", _same_sprint),
}


def _run_messages(messages: list[dict]) -> list[dict]:
    """本次运行的消息：最后一条 user 之后（含该 user）。"""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            return messages[i:]
    return list(messages)


def created_then_deleted(messages: list[dict], tool_calls: list[dict]) -> list[tuple[str, str]]:
    """本轮的 delete_X 调用里，目标对象是本次运行里 create_X 成功创建的 → [(delete 工具名, 对象标识)]。"""
    creates: list[tuple[str, dict, Any]] = []
    results: dict[str, Any] = {}
    run_msgs = _run_messages(messages)
    for m in run_msgs:
        if m.get("role") == "tool":
            results[m.get("tool_call_id")] = tool_data(m.get("content"))
    for m in run_msgs:
        if m.get("role") != "assistant":
            continue
        for tc in m.get("tool_calls") or []:
            name = (tc.get("function") or {}).get("name", "")
            if name.startswith("create_") and tc.get("id") in results and results[tc["id"]] is not None:
                try:
                    creates.append((name, raw_args(tc), results[tc["id"]]))
                except ValueError:
                    continue
    out: list[tuple[str, str]] = []
    for tc in tool_calls:
        name = (tc.get("function") or {}).get("name", "")
        pair = _CREATE_OF_DELETE.get(name)
        if pair is None:
            continue
        create_name, same = pair
        try:
            d_args = raw_args(tc)
        except ValueError:
            continue
        for c_name, c_args, c_data in creates:
            if c_name == create_name and (key := same(c_args, c_data, d_args)):
                out.append((name, key))
                break
    return out


def is_optimistic_conflict(call_id: str, result: dict, cards: dict) -> bool:
    """可重出卡的冲突：409 + code=CONFLICT + 该调用出过确认卡。"""
    return result.get("status") == 409 and result.get("code") == CONFLICT_CODE and call_id in cards


def make_observe_node(settings: Settings, audit=None) -> Callable[[AgentState], Awaitable[dict]]:
    async def observe(state: AgentState) -> dict:
        tool_calls = last_tool_calls(state.get("messages", []))
        targets = target_ids(state, tool_calls)
        results = state.get("pending_results") or {}
        cards = state.get("cards") or {}
        retries = dict(state.get("conflict_retries") or {})
        msgs: list[dict] = []
        conflicts: list[str] = []
        run_id = state.get("run_id", "")
        for tool, key in created_then_deleted(state.get("messages", []), [tc for tc in tool_calls if tc.get("id") in targets]):
            flag = f"{FLAG_CREATE_THEN_DELETE}:{tool}:{key}"
            log.warning("%s run=%s: 同次运行里创建后紧接删除同一对象", flag, run_id,
                        extra={"flag": FLAG_CREATE_THEN_DELETE, "run_id": run_id, "tool": tool, "target": key})
            if audit is not None:
                await audit.flag_run(run_id, flag)
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
