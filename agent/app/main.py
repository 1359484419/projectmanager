"""FastAPI 入口：生命周期（MCP 会话管理器 / PG checkpointer / 审计表 setup / 图组装 / 会话保留定时清理）、路由、统一错误体、结构化日志。

/mcp 子应用（app/mcp）只依赖 PmClient：LLM 或 agent DB 初始化失败时助手路由 503，MCP 照常。

生产：uvicorn app.main:app（组件在 lifespan 里按 settings 创建）。
测试：create_app(llm=FakeLLM, checkpointer=InMemorySaver(), audit=MemoryAudit()) 直接组装，不需要 lifespan。
"""
import asyncio
import json
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import health as health_api
from app.api.deps import ApiError
from app.api.threads import router as threads_router
from app.graph import build_graph
from app.harness.audit import Audit, PgAudit
from app.harness.retention import cleanup_expired_threads
from app.harness.thread_lock import ThreadLocks
from app.llm import LLM, make_llm
from app.mcp.server import MCP_PATH, build_mcp_app, build_mcp_server, mcp_exact_route
from app.nodes._emit import emit
from app.settings import Settings, get_settings

log = logging.getLogger("pm.agent")


class JsonFormatter(logging.Formatter):
    """一行一个 JSON（spec §7.8）。"""

    def format(self, record: logging.LogRecord) -> str:
        row: dict[str, Any] = {"ts": datetime.now(UTC).isoformat(timespec="milliseconds"), "level": record.levelname,
                               "logger": record.name, "msg": record.getMessage()}
        if record.exc_info:
            row["exc"] = self.formatException(record.exc_info)
        return json.dumps(row, ensure_ascii=False)


def setup_logging() -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for noisy in ("httpx", "httpx2"):  # 每次回调后端/网关都打一行太吵（httpx2 是 openai SDK 内置的）
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _emit_text(piece: str) -> None:
    emit({"type": "text_delta", "text": piece})


async def _ensure_schema(settings: Settings) -> None:
    """checkpointer 的表建在独立 schema 里：CREATE SCHEMA 必须先于 saver.setup()。"""
    import psycopg
    async with await psycopg.AsyncConnection.connect(settings.agent_db_url, autocommit=True) as conn:
        await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {settings.agent_db_schema}")


async def _open_checkpointer(settings: Settings):
    """AsyncPostgresSaver + psycopg 连接池（search_path 钉到 agent schema；saver 要求 autocommit + dict_row）。"""
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    pool = AsyncConnectionPool(
        settings.agent_db_url, open=False, min_size=1, max_size=settings.agent_db_pool_size,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row,
                "options": f"-c search_path={settings.agent_db_schema},public"})
    await pool.open()
    saver = AsyncPostgresSaver(pool)
    await saver.setup()
    return saver, pool


async def _retention_loop(settings: Settings) -> None:
    """spec §5.3：会话历史保留 thread_retention_days 天，每 retention_check_seconds 清理一次（失败只记日志）。"""
    while True:
        try:
            await cleanup_expired_threads(settings.agent_db_url, settings.agent_db_schema, settings.thread_retention_days)
        except Exception:  # noqa: BLE001 —— 清理失败不影响服务
            log.exception("retention cleanup failed")
        await asyncio.sleep(settings.retention_check_seconds)


def _assemble(app: FastAPI) -> None:
    st = app.state
    st.graph = build_graph(llm=st.llm, settings=st.settings, checkpointer=st.checkpointer, now_fn=st.now_fn,
                           audit=st.audit)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """MCP 会话管理器先起（只依赖 PmClient）；LLM / checkpointer / 审计初始化失败只记日志，/mcp 不受影响，
    助手路由在 graph 缺失时回 503 ASSISTANT_UNAVAILABLE（deps.require_assistant）。"""
    st = app.state
    settings: Settings = st.settings
    pool = None
    owned_audit: PgAudit | None = None
    retention_task: asyncio.Task | None = None
    async with st.mcp_server.session_manager.run():
        st.mcp_ready = True
        try:
            if st.checkpointer is None:
                await _ensure_schema(settings)
                st.checkpointer, pool = await _open_checkpointer(settings)
            if st.audit is None:
                owned_audit = PgAudit(settings.agent_db_url, schema=settings.agent_db_schema,
                                      max_size=settings.agent_db_pool_size)
                await owned_audit.setup()
                st.audit = owned_audit
            if st.llm is None:
                st.llm = make_llm(settings, on_text=_emit_text)
            if st.graph is None:
                _assemble(app)
            if pool is not None:   # 真 PG：会话保留定时清理（测试注入 InMemorySaver 时不跑）
                retention_task = asyncio.create_task(_retention_loop(settings))
            log.info("pm-agent ready model=%s stream=%s retention_days=%s", settings.llm_model, settings.llm_stream,
                     settings.thread_retention_days)
        except Exception:  # noqa: BLE001 —— 助手不可用不拖垮 MCP；/health 分开报告
            log.exception("assistant init failed (LLM/DB); %s still serves", MCP_PATH)
            st.graph = None
        try:
            yield
        finally:
            st.mcp_ready = False
            if retention_task is not None:
                retention_task.cancel()
                try:
                    await retention_task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
            if owned_audit is not None:
                await owned_audit.close()
                st.audit = None
            if pool is not None:
                await pool.close()
                st.checkpointer = None
            st.graph = None


def create_app(*, settings: Settings | None = None, llm: LLM | None = None, checkpointer: Any = None,
               audit: Audit | None = None, now_fn: Callable[[], datetime] = _utc_now) -> FastAPI:
    setup_logging()
    app = FastAPI(title="pm-agent", lifespan=lifespan, docs_url=None, redoc_url=None)
    st = app.state
    st.settings = settings or get_settings()
    st.llm, st.checkpointer, st.audit, st.now_fn = llm, checkpointer, audit, now_fn
    st.graph = None
    st.health_cache = None
    st.thread_locks = ThreadLocks()   # 同一线程同时只跑一个请求（messages/resume 入口 409 THREAD_BUSY）
    st.mcp_server = build_mcp_server()   # MCP 子应用：独立于 LLM / checkpointer / 审计，lifespan 里启动会话管理器
    st.mcp_ready = False
    app.mount(MCP_PATH, build_mcp_app(st.mcp_server))
    app.router.routes.append(mcp_exact_route(st.mcp_server))   # 裸 /mcp 不 307
    if llm is not None and checkpointer is not None:
        _assemble(app)  # 测试注入：不经 lifespan 也能用

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.body())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        """请求体/参数校验失败也用统一的 {code, message}（与 Java GlobalExceptionHandler 一致），不用默认 {detail}。"""
        first = (exc.errors() or [{}])[0]
        loc = ".".join(str(x) for x in first.get("loc", ()) if x != "body") or "body"
        return JSONResponse(status_code=422, content={"code": "VALIDATION", "message": f"{loc}: {first.get('msg', '')}"})

    @app.get("/health")
    async def health(request: Request) -> dict:
        return await health_api.check_health(request.app.state)

    app.include_router(threads_router)
    return app


app = create_app()
