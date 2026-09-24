"""会话保留（spec §5.3）：最新 checkpoint 早于 thread_retention_days 的线程整体删除（checkpoint 三表 + runs/tool_calls）。

生命周期由 main.py 的 lifespan 托管：启动后每 retention_check_seconds 跑一次；也可单独调用做一次性清理。
只删"整条线程都过期"的数据：线程最近一次 checkpoint 或最近一次 run 仍在保留期内就整条保留（幂等，可重复执行）。
"""
import logging
from datetime import UTC, datetime, timedelta

log = logging.getLogger("pm.agent.retention")


async def cleanup_expired_threads(dsn: str, schema: str, days: int, *, now: datetime | None = None) -> list[str]:
    """返回被删除的 thread_id 列表。"""
    import psycopg

    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
        # 线程最近活动时间 = max(最新 checkpoint 的 ts, 最新 run 的 started_at)
        cur = await conn.execute(
            f"""
            WITH last_cp AS (
                SELECT thread_id, max((checkpoint->>'ts')::timestamptz) AS ts FROM {schema}.checkpoints GROUP BY thread_id
            ), last_run AS (
                SELECT thread_id, max(started_at) AS ts FROM {schema}.runs GROUP BY thread_id
            ), threads AS (
                SELECT thread_id FROM last_cp UNION SELECT thread_id FROM last_run
            )
            SELECT t.thread_id FROM threads t
            LEFT JOIN last_cp c ON c.thread_id = t.thread_id
            LEFT JOIN last_run r ON r.thread_id = t.thread_id
            WHERE coalesce(greatest(c.ts, r.ts), c.ts, r.ts) < %s
            ORDER BY t.thread_id
            """,
            (cutoff,))
        expired = [row[0] for row in await cur.fetchall()]
        if not expired:
            return []
        for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            await conn.execute(f"DELETE FROM {schema}.{table} WHERE thread_id = ANY(%s)", (expired,))
        await conn.execute(
            f"DELETE FROM {schema}.tool_calls WHERE run_id IN (SELECT run_id FROM {schema}.runs WHERE thread_id = ANY(%s))",
            (expired,))
        await conn.execute(f"DELETE FROM {schema}.runs WHERE thread_id = ANY(%s)", (expired,))
    log.info("retention: removed %d expired threads (older than %d days)", len(expired), days)
    return expired
