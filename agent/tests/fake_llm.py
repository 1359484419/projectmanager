"""假模型客户端：按脚本顺序返回 assistant 消息，记录每次收到的 messages/tools（不需要真网关）。"""
import json
from typing import Any


def text(content: str, *, reasoning: str | None = None) -> dict:
    msg: dict[str, Any] = {"role": "assistant", "content": content}
    if reasoning is not None:
        msg["reasoning"] = reasoning
    return msg


def tool_call(name: str, args: dict, call_id: str) -> dict:
    return {"type": "function", "id": call_id,
            "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}


def calls(*tcs: dict, content: str | None = None, reasoning: str | None = None) -> dict:
    msg: dict[str, Any] = {"role": "assistant", "content": content, "tool_calls": list(tcs)}
    if reasoning is not None:
        msg["reasoning"] = reasoning
    return msg


class FakeLLM:
    """scripted 用尽后返回一条固定文本（避免图测试死循环）。"""

    def __init__(self, scripted: list[dict], *, usage: dict | None = None):
        self.scripted = list(scripted)
        self.calls: list[dict] = []
        self.usage = usage or {"prompt_tokens": 100, "completion_tokens": 10}

    async def chat(self, messages: list[dict], tools: list[dict]) -> dict:
        self.calls.append({"messages": [dict(m) for m in messages], "tools": tools})
        msg = self.scripted.pop(0) if self.scripted else text("（脚本用尽）")
        return {**msg, "usage": dict(self.usage)}
