"""/health：存活 + LLM 网关连通性，结果缓存 settings.health_cache_seconds 秒（探活不能每次都打网关）。"""
import logging
from time import monotonic
from typing import Any

log = logging.getLogger("pm.agent.health")


async def _llm_reachable(llm: Any) -> bool:
    ping = getattr(llm, "ping", None)
    if ping is None:
        return True  # 没有探活能力的实现（测试假模型）视为可达
    try:
        await ping()
        return True
    except Exception as exc:  # noqa: BLE001 —— 任何异常都算不可达，只记日志
        log.warning("llm ping failed: %s: %s", type(exc).__name__, exc)
        return False


async def check_health(state: Any) -> dict:
    """state 为 FastAPI app.state：读 llm/settings，缓存放在 state.health_cache。"""
    cached = getattr(state, "health_cache", None)
    now = monotonic()
    if cached and now - cached[0] < state.settings.health_cache_seconds:
        return cached[1]
    reachable = await _llm_reachable(getattr(state, "llm", None))
    result = {"status": "ok" if reachable else "degraded", "llm": "ok" if reachable else "unreachable"}
    state.health_cache = (now, result)
    return result
