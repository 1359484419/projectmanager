"""Java REST 客户端：租户 slug 只来自请求上下文，自动带用户 JWT 与 X-PM-Source: AGENT。

错误统一映射为 PmApiError({status, code, message})；写操作不重试（防重复创建），GET 按 retry 策略重试。
"""
import json
from typing import Any

import httpx

from app.harness import retry
from app.harness.auth import RequestCtx, current_ctx
from app.settings import get_settings


class PmApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class TokenExpired(PmApiError):
    """后端 401：用户 access token 已过期。不交给模型，穿透到 API 层发 error{TOKEN_EXPIRED}，前端刷新后重发。"""


class PmClient:
    def __init__(self, ctx: RequestCtx, base_url: str | None = None, timeout: float = 15.0):
        self._ctx = ctx
        self._base = (base_url or get_settings().pm_api_url).rstrip("/")
        self._timeout = timeout

    # ---------- 公开方法 ----------

    async def get(self, path: str, params: dict | None = None) -> Any:
        return await self._request("GET", path, params=params)

    async def post(self, path: str, json: Any = None) -> Any:
        return await self._request("POST", path, json=json)

    async def patch(self, path: str, json: Any) -> Any:
        return await self._request("PATCH", path, json=json)

    async def put(self, path: str, json: Any) -> Any:
        return await self._request("PUT", path, json=json)

    async def delete(self, path: str) -> None:
        return await self._request("DELETE", path)

    # ---------- 内部 ----------

    def _url(self, path: str) -> str:
        return f"{self._base}/api/t/{self._ctx.tenant}/{path.lstrip('/')}"

    def _headers(self) -> dict[str, str]:
        jwt = self._ctx.jwt
        auth = jwt if jwt.lower().startswith("bearer ") else f"Bearer {jwt}"
        return {"Authorization": auth, "X-PM-Source": "AGENT", "Accept": "application/json"}

    async def _request(self, method: str, path: str, *, params: dict | None = None,
                       json: Any = None) -> Any:
        max_retries = get_settings().get_max_retries if method == "GET" else 0
        attempt = 0
        while True:
            try:
                # trust_env=False：后端是本机 127.0.0.1，不走开发机环境里的 HTTP/SOCKS 代理
                async with httpx.AsyncClient(timeout=self._timeout, trust_env=False) as http:
                    resp = await http.request(method, self._url(path), params=params, json=json,
                                              headers=self._headers())
            except httpx.TransportError as exc:
                if retry.classify_http(None, method, exc) is retry.RetryClass.RETRY_GET_ONLY \
                        and attempt < max_retries:
                    await retry.sleep_backoff(attempt)
                    attempt += 1
                    continue
                code = "TIMEOUT" if isinstance(exc, httpx.TimeoutException) else "CONNECTION_ERROR"
                raise PmApiError(0, code, f"无法连接后端：{exc.__class__.__name__}") from exc

            if resp.is_success:
                return _parse_body(resp)
            if retry.classify_http(resp.status_code, method, None) is retry.RetryClass.RETRY_GET_ONLY \
                    and attempt < max_retries:
                await retry.sleep_backoff(attempt)
                attempt += 1
                continue
            raise _to_error(resp)


def _parse_body(resp: httpx.Response) -> Any:
    if resp.status_code == 204 or not resp.content:
        return None
    try:
        return resp.json()
    except (json.JSONDecodeError, ValueError):
        return resp.text


def _to_error(resp: httpx.Response) -> PmApiError:
    code, message = f"HTTP_{resp.status_code}", resp.text[:200]
    try:
        body = resp.json()
        if isinstance(body, dict):
            code = str(body.get("code") or code)
            message = str(body.get("message") or message)
    except (json.JSONDecodeError, ValueError):
        pass
    if resp.status_code == 401:
        return TokenExpired(401, "TOKEN_EXPIRED", message or "登录已过期")
    return PmApiError(resp.status_code, code, message)


def client() -> PmClient:
    """按当前请求上下文构造客户端（无上下文 → RuntimeError）。"""
    return PmClient(current_ctx())
