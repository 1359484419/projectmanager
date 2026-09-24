"""guard/act/observe 共用：从状态里取最后一条带 tool_calls 的 assistant 消息，解析入参。"""
import json

from pydantic import BaseModel, ValidationError

from app.harness.tool_guard import ToolSpec


def last_tool_calls(messages: list[dict]) -> list[dict]:
    for m in reversed(messages):
        if m.get("role") == "assistant":
            return list(m.get("tool_calls") or [])
        if m.get("role") == "user":
            break
    return []


def raw_args(tc: dict) -> dict:
    """tool_call.function.arguments（JSON 字符串）→ dict；解析失败 → ValueError。"""
    raw = (tc.get("function") or {}).get("arguments") or "{}"
    if isinstance(raw, dict):
        return raw
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("arguments 必须是 JSON 对象")
    return data


def parse_args(spec: ToolSpec, data: dict) -> BaseModel:
    return spec.params(**data)


def validation_message(exc: Exception) -> str:
    """pydantic 错误 → 简短中文，回给模型自纠。"""
    if isinstance(exc, ValidationError):
        parts = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", ())) or "参数"
            msg = e.get("msg", "")
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            parts.append(f"{loc}: {msg}")
        return "；".join(parts)[:300]
    return str(exc)[:300]


def target_ids(state: dict, tool_calls: list[dict]) -> list[str]:
    """本轮要处理的 callId：409 重出卡时只含冲突的（pending_call_ids 是当前 tool_calls 的真子集），否则全部。"""
    ids = [tc.get("id") for tc in tool_calls]
    pending = state.get("pending_call_ids") or []
    if pending and all(p in ids for p in pending) and set(pending) != set(ids):
        return [i for i in ids if i in pending]
    return ids
