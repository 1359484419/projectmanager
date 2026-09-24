"""循环与预算防护（spec §7.6）：同工具同参数连续重复、轮数、token 上限；阈值只从 settings 读。"""
import json

from app.settings import Settings


def call_signature(name: str, args: dict) -> str:
    """判定必须含参数：只看工具名会误伤分页/逐条查询。"""
    return f"{name}:{json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)}"


def is_repeating(sigs: list[str], new: str, limit: int = 3) -> bool:
    """历史签名的最近 limit-1 条都等于 new → 连同本次已连续 limit 次。"""
    if limit <= 1:
        return True
    tail = sigs[-(limit - 1):]
    return len(tail) == limit - 1 and all(s == new for s in tail)


def over_limits(state: dict, settings: Settings) -> str | None:
    if int(state.get("round", 0)) >= settings.max_tool_rounds:
        return "MAX_ROUNDS"
    if int(state.get("tokens_used", 0)) >= settings.max_tokens_per_run:
        return "MAX_TOKENS"
    return None
