"""请求级依赖：网关 header → RequestCtx；线程归属校验；统一的 {code, message} 错误。

Python 不做权限：JWT 与租户成员身份已由 Java 反代校验，这里只信任反代注入的 header。
"""
import re
import uuid

from fastapi import Header, Request

from app.harness.auth import RequestCtx
from app.schemas import to_wire

THREAD_PREFIX = "t_"
# 与 Java AuthService.SLUG 同一正则：线程 id 前缀 t_{tenant}_{user}_ 依赖 tenant 里没有下划线
TENANT_RE = re.compile(r"^[a-z0-9-]{3,32}$")
# X-PM-Page / X-PM-Project 来自前端查询参数（?page= / ?project=），只作定位指代、原样进系统提示：
# 不合法就当没有（置 None，不报错），防止往自己会话的系统提示里塞指令
PAGE_RE = re.compile(r"^/t/[a-z0-9-]{3,32}/[a-z]+(/[A-Za-z0-9-]+)?$")
PAGE_MAX_LEN = 128
PROJECT_RE = re.compile(r"^[A-Z][A-Z0-9]{0,9}$")   # 比 Java ProjectService.KEY_PATTERN（^[A-Z]{2,6}$）略宽


class ApiError(Exception):
    """HTTP 错误：GlobalExceptionHandler 风格的 {code, message}（与 Java 端一致）。"""

    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def body(self) -> dict:
        """extra 用内部 snake_case 传入，这里经 to_wire 输出 camelCase（如 pending_cards → pendingCards）。"""
        return to_wire({"code": self.code, "message": self.message, **self.extra})


def require_assistant(request: Request) -> None:
    """lifespan 里 LLM / DB 初始化失败时 graph 为 None：助手路由统一 503（MCP 子应用不受影响）。"""
    if getattr(request.app.state, "graph", None) is None:
        raise ApiError(503, "ASSISTANT_UNAVAILABLE", "助手未就绪（模型或数据库初始化失败）")


def not_found() -> ApiError:
    """线程不存在 / 不属于当前用户：统一 404，不泄露存在性。"""
    return ApiError(404, "NOT_FOUND", "会话不存在")


async def gateway_ctx(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    tenant: str | None = Header(default=None, alias="X-PM-Tenant"),
    user: str | None = Header(default=None, alias="X-PM-User"),
    project: str | None = Header(default=None, alias="X-PM-Project"),
    page: str | None = Header(default=None, alias="X-PM-Page"),
) -> RequestCtx:
    missing = [n for n, v in (("Authorization", authorization), ("X-PM-Tenant", tenant), ("X-PM-User", user))
               if not v]
    if missing:
        raise ApiError(400, "BAD_GATEWAY_HEADERS", f"缺少网关注入的 header: {', '.join(missing)}")
    try:
        user_id = int(user)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ApiError(400, "BAD_GATEWAY_HEADERS", "X-PM-User 必须是整数") from None
    if user_id <= 0:
        raise ApiError(400, "BAD_GATEWAY_HEADERS", "X-PM-User 必须是正整数")
    if not tenant or not TENANT_RE.match(tenant):
        raise ApiError(400, "BAD_GATEWAY_HEADERS", "X-PM-Tenant 非法")
    return RequestCtx(jwt=authorization or "", tenant=tenant, user_id=user_id,
                      project_key=clean_project(project), page=clean_page(page))


def clean_page(page: str | None) -> str | None:
    return page if page and len(page) <= PAGE_MAX_LEN and PAGE_RE.match(page) else None


def clean_project(project: str | None) -> str | None:
    return project if project and PROJECT_RE.match(project) else None


def thread_prefix(ctx: RequestCtx) -> str:
    return f"{THREAD_PREFIX}{ctx.tenant}_{ctx.user_id}_"


def new_thread_id(ctx: RequestCtx) -> str:
    return f"{thread_prefix(ctx)}{uuid.uuid4().hex}"


def require_own_thread(thread_id: str, ctx: RequestCtx) -> str:
    """id 前缀必须等于 t_{tenant}_{user}_，否则 404（Review Focus 4）。"""
    prefix = thread_prefix(ctx)
    if not thread_id.startswith(prefix) or len(thread_id) <= len(prefix):
        raise not_found()
    return thread_id
