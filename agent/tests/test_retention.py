"""会话保留（spec §5.3）：按 settings.thread_retention_days 清理过期线程的 checkpoint 与审计行（评审 #13）。

需要本地 PG（AGENT_DB_URL，默认 localhost:5433）；不可达自动 skip。
"""
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.harness.retention import cleanup_expired_threads
from app.settings import get_settings


async def _pg_available(dsn: str) -> bool:
    try:
        import psycopg
        conn = await psycopg.AsyncConnection.connect(dsn, connect_timeout=2)
        await conn.close()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _seed_thread(conn, schema: str, thread_id: str, ts: datetime) -> None:
    """模拟一条线程：两个 checkpoint（旧+更旧）、对应 writes/blobs、一条 run 与 tool_call。"""
    for i in range(2):
        cid = f"{ts.timestamp():.0f}-{i}"
        cp = {"v": 1, "ts": (ts - timedelta(minutes=i)).isoformat(), "id": cid, "channel_values": {}}
        await conn.execute(
            f"INSERT INTO {schema}.checkpoints (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata) "
            "VALUES (%s, '', %s, 'json', %s::jsonb, '{}'::jsonb)", (thread_id, cid, json.dumps(cp)))
        await conn.execute(
            f"INSERT INTO {schema}.checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob) "
            "VALUES (%s, '', %s, 't', 0, 'messages', 'json', %s)", (thread_id, cid, b"{}"))
    await conn.execute(
        f"INSERT INTO {schema}.checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob) "
        "VALUES (%s, '', 'messages', '1', 'json', %s)", (thread_id, b"{}"))
    run_id = uuid.uuid4().hex
    await conn.execute(
        f"INSERT INTO {schema}.runs (run_id, thread_id, tenant_slug, user_id, input_text, started_at) "
        "VALUES (%s, %s, 'acme', 7, 'x', %s)", (run_id, thread_id, ts))
    await conn.execute(
        f"INSERT INTO {schema}.tool_calls (run_id, call_id, tool, risk) VALUES (%s, 'c1', 'list_projects', 'L0')", (run_id,))


async def _counts(conn, schema: str, thread_id: str) -> dict[str, int]:
    out = {}
    for t in ("checkpoints", "checkpoint_writes", "checkpoint_blobs", "runs"):
        cur = await conn.execute(f"SELECT count(*) FROM {schema}.{t} WHERE thread_id=%s", (thread_id,))
        out[t] = (await cur.fetchone())[0]
    cur = await conn.execute(f"SELECT count(*) FROM {schema}.tool_calls WHERE run_id IN "
                             f"(SELECT run_id FROM {schema}.runs WHERE thread_id=%s)", (thread_id,))
    out["tool_calls"] = (await cur.fetchone())[0]
    return out


@pytest.mark.pg
async def test_cleanup_removes_only_threads_older_than_retention():
    settings = get_settings()
    if not await _pg_available(settings.agent_db_url):
        pytest.skip("本地 PG 不可达，跳过保留清理测试")
    import psycopg
    from app.harness.audit import PgAudit
    from app.main import _ensure_schema, _open_checkpointer
    await _ensure_schema(settings)
    _, pool = await _open_checkpointer(settings)         # 建 checkpoint 表（幂等）
    await pool.close()
    audit = PgAudit(settings.agent_db_url, schema=settings.agent_db_schema)
    await audit.setup()                                  # 建审计表（幂等）
    await audit.close()

    schema = settings.agent_db_schema
    old_tid = f"t_acme_7_{uuid.uuid4().hex}"
    new_tid = f"t_acme_7_{uuid.uuid4().hex}"
    now = datetime.now(UTC)
    async with await psycopg.AsyncConnection.connect(settings.agent_db_url, autocommit=True) as conn:
        try:
            await _seed_thread(conn, schema, old_tid, now - timedelta(days=settings.thread_retention_days + 1))
            await _seed_thread(conn, schema, new_tid, now - timedelta(days=settings.thread_retention_days - 1))
            removed = await cleanup_expired_threads(settings.agent_db_url, schema, settings.thread_retention_days,
                                                    now=now)
            assert old_tid in removed and new_tid not in removed
            assert _sum(await _counts(conn, schema, old_tid)) == 0
            assert await _counts(conn, schema, new_tid) == {"checkpoints": 2, "checkpoint_writes": 2,
                                                             "checkpoint_blobs": 1, "runs": 1, "tool_calls": 1}
            # 幂等：再跑一次不报错、不再删
            assert await cleanup_expired_threads(settings.agent_db_url, schema, settings.thread_retention_days,
                                                 now=now) == []
        finally:
            for tid in (old_tid, new_tid):
                for t in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                    await conn.execute(f"DELETE FROM {schema}.{t} WHERE thread_id=%s", (tid,))
                await conn.execute(f"DELETE FROM {schema}.tool_calls WHERE run_id IN "
                                   f"(SELECT run_id FROM {schema}.runs WHERE thread_id=%s)", (tid,))
                await conn.execute(f"DELETE FROM {schema}.runs WHERE thread_id=%s", (tid,))


def _sum(counts: dict[str, int]) -> int:
    return sum(counts.values())


def test_retention_setting_is_consumed_by_lifespan():
    """「声明未接线」守卫：settings.thread_retention_days 必须有消费点（main.py 定时清理）。"""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()
    assert "thread_retention_days" in src and "cleanup_expired_threads" in src
