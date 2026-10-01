"""MCP 工具执行 harness：请求头 → RequestCtx、入参校验、异常 → {code, message}（无堆栈）、输出清洗。

所有 MCP 工具（含旧名别名、resources）都经 run_tool / with_ctx 执行；工具本体不接触 header 与异常映射。
"""
import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from mcp_types import CallToolResult, TextContent
from pydantic import BaseModel, ValidationError

from app.api.deps import TENANT_RE, clean_project
from app.harness.auth import RequestCtx, reset_ctx, set_ctx
from app.tools._client import PmApiError
from app.tools._resolve import NEXT_SPRINT_MISSING, Ambiguous, NotFound
from app.tools._wire import strip_internal

log = logging.getLogger("pm.agent.mcp")


class McpFail(Exception):
    """工具级失败：以 isError 结果回给客户端（不是 JSON-RPC error），只含 code/message（+candidates）。"""

    def __init__(self, code: str, message: str, **extra: Any):
        super().__init__(f"{code}: {message}")
        self.body: dict[str, Any] = {"code": code, "message": message, **extra}


def ctx_from_headers(headers: Mapping[str, str] | None) -> RequestCtx:
    """Java 反代注入 Authorization(PAT)/X-PM-Tenant/X-PM-User（可选 X-PM-Project）；缺一个都拒绝执行（fail-closed）。"""
    h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    auth, tenant, user = h.get("authorization"), h.get("x-pm-tenant"), h.get("x-pm-user")
    missing = [n for n, v in (("Authorization", auth), ("X-PM-Tenant", tenant), ("X-PM-User", user)) if not v]
    if missing:
        raise McpFail("BAD_GATEWAY_HEADERS", f"缺少网关注入的 header: {', '.join(missing)}")
    try:
        user_id = int(user)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise McpFail("BAD_GATEWAY_HEADERS", "X-PM-User 必须是整数") from None
    if user_id <= 0 or not tenant or not TENANT_RE.match(tenant):
        raise McpFail("BAD_GATEWAY_HEADERS", "X-PM-Tenant / X-PM-User 非法")
    return RequestCtx(jwt=auth or "", tenant=tenant, user_id=user_id,
                      project_key=clean_project(h.get("x-pm-project")), page=None)


CONFIRM_REQUIRED_MSG = "该操作不可逆：请先把影响展示给用户，取得明确同意后带 confirm=true 重新调用"
# MCP 端没有 create_sprint：NotFound 按 code 追加外部 agent 能做的补救（页内助手的对应表在 app/nodes/act.py::PAGE_HINTS）
MCP_HINTS = {NEXT_SPRINT_MISSING: "，请在网页「所有迭代」页创建"}


def _missing_confirm(exc: ValidationError) -> bool:
    """L3 工具漏传 confirm：与 confirm=false 同等对待（CONFIRM_REQUIRED），不当作泛化的 VALIDATION。"""
    return any(err.get("type") == "missing" and tuple(err.get("loc", ())) == ("confirm",) for err in exc.errors())


def _validation_message(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(x) for x in err.get("loc", ())) or "body"
        parts.append(f"{loc}: {err.get('msg', '')}")
    return "；".join(parts)


async def with_ctx(headers: Mapping[str, str] | None, fn: Callable[[], Awaitable[Any]]) -> Any:
    """在请求上下文里执行并把业务异常映射成 McpFail；未知异常只记日志、对外 INTERNAL（不泄露堆栈/消息）。"""
    token = set_ctx(ctx_from_headers(headers))
    try:
        return await fn()
    except McpFail:
        raise
    except NotFound as exc:
        raise McpFail(exc.code, exc.hinted(MCP_HINTS)) from exc
    except Ambiguous as exc:
        raise McpFail("AMBIGUOUS", exc.message, candidates=exc.candidates) from exc
    except PmApiError as exc:
        raise McpFail(exc.code, exc.message) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("mcp tool crashed: %s", type(exc).__name__)
        raise McpFail("INTERNAL", "工具执行失败，请稍后重试") from exc
    finally:
        reset_ctx(token)


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def error_result(fail: McpFail) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=_dumps(fail.body))],
                          structured_content=fail.body, is_error=True)


async def run_tool(params_model: type[BaseModel], call: Callable[[BaseModel], Awaitable[dict]],
                   arguments: dict, headers: Mapping[str, str] | None) -> CallToolResult:
    """校验入参 → 上下文内执行 → 输出剔除内部 id → 文本 + structuredContent。"""
    try:
        try:
            params = params_model.model_validate(arguments or {})
        except ValidationError as exc:
            if _missing_confirm(exc):
                raise McpFail("CONFIRM_REQUIRED", CONFIRM_REQUIRED_MSG) from exc
            raise McpFail("VALIDATION", _validation_message(exc)) from exc
        result = await with_ctx(headers, lambda: call(params))
    except McpFail as fail:
        return error_result(fail)
    cleaned = strip_internal(result if isinstance(result, dict) else {"result": result})
    return CallToolResult(content=[TextContent(type="text", text=_dumps(cleaned))], structured_content=cleaned)
