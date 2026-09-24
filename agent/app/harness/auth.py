"""请求上下文：Java 反代校验后注入的 JWT / 租户 / 用户，经 contextvars 传给工具层。

工具客户端拼 URL 的 slug 只来自这里，模型参数里没有租户概念。
"""
from contextvars import ContextVar, Token
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestCtx:
    jwt: str                  # 用户原始 access token（不落盘）
    tenant: str               # 租户 slug（来自 X-PM-Tenant）
    user_id: int              # 当前用户 id（来自 X-PM-User）
    project_key: str | None   # 面板带入的当前项目 key（可选）
    page: str | None          # 当前页面路由（可选，供提示词理解指代）


_ctx: ContextVar[RequestCtx | None] = ContextVar("pm_request_ctx", default=None)


def set_ctx(ctx: RequestCtx) -> Token:
    return _ctx.set(ctx)


def reset_ctx(token: Token) -> None:
    _ctx.reset(token)


def current_ctx() -> RequestCtx:
    ctx = _ctx.get()
    if ctx is None:
        raise RuntimeError("no request context")
    return ctx
