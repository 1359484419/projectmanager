"""审计（spec §7.8）：agent.runs / agent.tool_calls。只记 userId 与工具入参，不记 Authorization。

PgAudit 用 psycopg 连接池；MemoryAudit 供测试。审计失败不能拖垮主流程（记日志后吞掉）。
"""
import json
import logging
import pathlib
from datetime import UTC, datetime
from typing import Any, Protocol

log = logging.getLogger("pm.agent.audit")
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[2] / "migrations"


class Audit(Protocol):
    async def start_run(self, run_id: str, thread_id: str, tenant: str, user_id: int, input_text: str) -> None: ...
    async def end_run(self, run_id: str, status: str, tokens: int, error_code: str | None) -> None: ...
    async def tool_call(self, run_id: str, call_id: str, tool: str, risk: str, args: dict, decision: str,
                        http_status: int | None, summary: str, ms: int) -> None: ...
    async def flag_run(self, run_id: str, flag: str) -> None: ...


class MemoryAudit:
    def __init__(self):
        self.runs: dict[str, dict[str, Any]] = {}
        self.tool_calls: list[dict[str, Any]] = []

    async def start_run(self, run_id, thread_id, tenant, user_id, input_text) -> None:
        self.runs[run_id] = {"thread_id": thread_id, "tenant": tenant, "user_id": user_id, "input_text": input_text,
                             "started_at": datetime.now(UTC), "ended_at": None, "status": None, "tokens": None,
                             "error_code": None, "flags": []}

    async def end_run(self, run_id, status, tokens, error_code) -> None:
        self.runs.setdefault(run_id, {}).update(status=status, tokens=tokens, error_code=error_code,
                                                ended_at=datetime.now(UTC))

    async def flag_run(self, run_id, flag) -> None:
        self.runs.setdefault(run_id, {}).setdefault("flags", []).append(flag)

    async def tool_call(self, run_id, call_id, tool, risk, args, decision, http_status, summary, ms) -> None:
        self.tool_calls.append({"run_id": run_id, "call_id": call_id, "tool": tool, "risk": risk, "args": dict(args),
                                "decision": decision, "decided_at": datetime.now(UTC), "http_status": http_status,
                                "summary": summary, "ms": ms})


def migration_sql() -> str:
    return "\n".join(p.read_text() for p in sorted(MIGRATIONS_DIR.glob("*.sql")))


class PgAudit:
    """psycopg 异步连接池；setup() 执行 migrations/*.sql（全部 IF NOT EXISTS，幂等）。"""

    def __init__(self, dsn: str, schema: str = "agent", *, min_size: int = 1, max_size: int = 4):
        from psycopg_pool import AsyncConnectionPool
        self._schema = schema
        self._pool = AsyncConnectionPool(dsn, open=False, min_size=min_size, max_size=max_size,
                                         kwargs={"options": f"-c search_path={schema},public", "autocommit": True})

    async def setup(self) -> None:
        await self._pool.open()
        async with self._pool.connection() as conn:
            await conn.execute(migration_sql())

    async def close(self) -> None:
        await self._pool.close()

    async def _exec(self, sql: str, params: tuple) -> None:
        try:
            async with self._pool.connection() as conn:
                await conn.execute(sql, params)
        except Exception:  # noqa: BLE001 —— 审计失败只记日志，不影响用户操作
            log.exception("audit write failed")

    async def start_run(self, run_id, thread_id, tenant, user_id, input_text) -> None:
        await self._exec(
            f"INSERT INTO {self._schema}.runs (run_id, thread_id, tenant_slug, user_id, input_text) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (run_id) DO NOTHING",
            (run_id, thread_id, tenant, user_id, input_text))

    async def end_run(self, run_id, status, tokens, error_code) -> None:
        await self._exec(
            f"UPDATE {self._schema}.runs SET ended_at = now(), status = %s, tokens = %s, error_code = %s WHERE run_id = %s",
            (status, tokens, error_code, run_id))

    async def flag_run(self, run_id, flag) -> None:
        """观测标记追加到 runs.flags（jsonb 数组）；run 行不存在时无事发生。"""
        await self._exec(
            f"UPDATE {self._schema}.runs SET flags = flags || to_jsonb(%s::text) WHERE run_id = %s",
            (str(flag)[:200], run_id))

    async def tool_call(self, run_id, call_id, tool, risk, args, decision, http_status, summary, ms) -> None:
        from psycopg.types.json import Jsonb
        await self._exec(
            f"INSERT INTO {self._schema}.tool_calls (run_id, call_id, tool, risk, args, decision, http_status, summary, ms) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (run_id, call_id, tool, risk, Jsonb(json.loads(json.dumps(args, default=str))), decision, http_status,
             (summary or "")[:500], ms))
