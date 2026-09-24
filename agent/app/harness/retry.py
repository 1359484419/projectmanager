"""错误分类与重试策略（spec §7.5）。

- Java REST：GET 遇连接错误/超时/5xx 最多重试 settings.get_max_retries 次；写操作（POST/PATCH/PUT/DELETE）**永不自动重试**。
- LLM 网关：429/5xx/连接错误指数退避重试；4xx 不重试；尊重 Retry-After。
"""
import asyncio
from collections.abc import Awaitable, Callable
from enum import Enum
from typing import Any, TypeVar

import httpx

T = TypeVar("T")

_WRITE_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})


class RetryClass(Enum):
    NONE = "none"
    RETRY_GET_ONLY = "retry_get_only"
    RETRY_ALWAYS = "retry_always"


def _is_transport_error(exc: Exception | None) -> bool:
    return isinstance(exc, (httpx.TransportError, TimeoutError, ConnectionError))


def classify_http(status: int | None, method: str, exc: Exception | None) -> RetryClass:
    """按 HTTP 状态/异常与方法判定是否可重试。"""
    transient = _is_transport_error(exc) or (status is not None and status >= 500)
    if not transient:
        return RetryClass.NONE
    if method.upper() in _WRITE_METHODS:
        return RetryClass.NONE
    return RetryClass.RETRY_GET_ONLY


def backoff_seconds(attempt: int) -> float:
    """第 attempt 次重试前的等待：1, 2, 4 …"""
    return float(2 ** attempt)


async def sleep_backoff(attempt: int) -> None:
    """退避等待；测试里整体替换成 no-op。"""
    await asyncio.sleep(backoff_seconds(attempt))


def _llm_status(exc: BaseException) -> int | None:
    """从 openai.APIStatusError / httpx.HTTPStatusError 等取状态码。"""
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status
    resp = getattr(exc, "response", None)
    code = getattr(resp, "status_code", None)
    return code if isinstance(code, int) else None


def _retry_after(exc: BaseException) -> float | None:
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None)
    if not headers:
        return None
    raw = headers.get("Retry-After") if hasattr(headers, "get") else None
    if raw is None:
        return None
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return None


def llm_retryable(exc: BaseException) -> bool:
    status = _llm_status(exc)
    if status is None:
        # 无状态码：连接/超时类可重试，其余（编程错误等）不重试
        return _is_transport_error(exc) or type(exc).__name__ in {
            "APIConnectionError", "APITimeoutError"}
    return status == 429 or status >= 500


async def with_llm_retry(fn: Callable[[], Awaitable[T]], *, max_retries: int) -> T:
    """包裹一次模型调用：429/5xx/连接错误退避重试，4xx 直接抛。"""
    attempt = 0
    while True:
        try:
            return await fn()
        except BaseException as exc:  # noqa: BLE001 —— 由 llm_retryable 决定
            if attempt >= max_retries or not llm_retryable(exc):
                raise
            wait = _retry_after(exc)
            if wait is not None:
                await asyncio.sleep(wait)
            else:
                await sleep_backoff(attempt)
            attempt += 1
