import httpx
import pytest
from app.harness.retry import classify_http, RetryClass, backoff_seconds, with_llm_retry

def test_classify():
    assert classify_http(502, "GET", None) == RetryClass.RETRY_GET_ONLY
    assert classify_http(502, "POST", None) == RetryClass.NONE
    assert classify_http(None, "GET", httpx.ConnectError("x")) == RetryClass.RETRY_GET_ONLY
    assert classify_http(None, "GET", httpx.ReadTimeout("x")) == RetryClass.RETRY_GET_ONLY
    assert classify_http(None, "PATCH", httpx.ConnectError("x")) == RetryClass.NONE
    for s in (400, 401, 403, 404, 409):
        assert classify_http(s, "GET", None) == RetryClass.NONE
    assert classify_http(200, "GET", None) == RetryClass.NONE
    assert [backoff_seconds(i) for i in range(3)] == [1, 2, 4]


class _Status(Exception):
    """模拟带 status_code / response 的网关错误（openai.APIStatusError 形状）。"""
    def __init__(self, status_code, headers=None):
        super().__init__(f"status {status_code}")
        self.status_code = status_code
        self.response = httpx.Response(status_code, headers=headers or {})


async def test_llm_retry_on_429_then_success():
    calls = []
    async def fn():
        calls.append(1)
        if len(calls) < 3:
            raise _Status(429)
        return "ok"
    assert await with_llm_retry(fn, max_retries=3) == "ok"
    assert len(calls) == 3


async def test_llm_no_retry_on_4xx():
    calls = []
    async def fn():
        calls.append(1)
        raise _Status(400)
    with pytest.raises(_Status):
        await with_llm_retry(fn, max_retries=3)
    assert len(calls) == 1


async def test_llm_retry_exhausted_reraises():
    calls = []
    async def fn():
        calls.append(1)
        raise httpx.ConnectError("down")
    with pytest.raises(httpx.ConnectError):
        await with_llm_retry(fn, max_retries=2)
    assert len(calls) == 3


async def test_llm_retry_respects_retry_after(monkeypatch):
    from app.harness import retry
    slept = []
    async def fake_sleep(seconds):
        slept.append(seconds)
    monkeypatch.setattr(retry.asyncio, "sleep", fake_sleep)
    calls = []
    async def fn():
        calls.append(1)
        if len(calls) == 1:
            raise _Status(429, {"Retry-After": "7"})
        return "ok"
    assert await with_llm_retry(fn, max_retries=1) == "ok"
    assert slept == [7.0]
