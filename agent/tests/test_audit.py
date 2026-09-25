"""审计：MemoryAudit 记录完整行；图执行时 act 写审计；PG 建表脚本幂等（需要本地 PG，否则 skip）。"""
import pathlib

import pytest
import respx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.graph import build_graph
from app.harness.audit import MemoryAudit, PgAudit
from app.harness.auth import reset_ctx, set_ctx
from app.settings import get_settings
from tests._fx import BASE, CTX, fx, mock_common, ok
from tests.fake_llm import FakeLLM, calls, text, tool_call

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "migrations" / "001_audit.sql"


@pytest.fixture(autouse=True)
def _ctx():
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


async def test_memory_audit_records_full_rows():
    a = MemoryAudit()
    await a.start_run("r1", "t_acme_7_x", "acme", 7, "把 PM-12 改成已完成")
    await a.tool_call("r1", "c1", "update_task_status", "L2", {"task_key": "PM-12", "status": "COMPLETED"},
                      "approve", 200, "PM-12「登录页接入短信验证」", 12)
    await a.end_run("r1", "ok", 1234, None)
    assert a.runs["r1"]["tenant"] == "acme" and a.runs["r1"]["status"] == "ok" and a.runs["r1"]["tokens"] == 1234
    assert a.runs["r1"]["error_code"] is None and a.runs["r1"]["ended_at"] is not None
    row = a.tool_calls[0]
    assert row == {"run_id": "r1", "call_id": "c1", "tool": "update_task_status", "risk": "L2",
                   "args": {"task_key": "PM-12", "status": "COMPLETED"}, "decision": "approve",
                   "http_status": 200, "summary": "PM-12「登录页接入短信验证」", "ms": 12,
                   "decided_at": row["decided_at"]}


@respx.mock
async def test_act_writes_audit_for_l2_approve_and_reject():
    mock_common()
    respx.patch(f"{BASE}/tasks/112").mock(return_value=ok({**fx("task_12"), "status": "COMPLETED"}))
    audit = MemoryAudit()
    llm = FakeLLM([calls(tool_call("list_projects", {}, "c0"),
                         tool_call("update_task_status", {"task_key": "PM-12", "status": "COMPLETED"}, "c1")),
                   text("done")])
    g = build_graph(llm=llm, settings=get_settings(), checkpointer=InMemorySaver(), audit=audit)
    cfg = {"configurable": {"thread_id": "a1"}}
    await g.ainvoke({"messages": [{"role": "user", "content": "x"}], "round": 0, "tokens_used": 0,
                     "run_id": "run-1", "decisions": {}, "cards": {}, "conflict_retries": {}, "last_call_sigs": []}, cfg)
    assert audit.tool_calls == []                      # 挂起时还没执行，不记
    await g.ainvoke(Command(resume={"type": "approve"}), cfg)
    rows = {r["call_id"]: r for r in audit.tool_calls}
    assert rows["c0"]["risk"] == "L0" and rows["c0"]["decision"] == "none" and rows["c0"]["http_status"] == 200
    assert rows["c1"] == {**rows["c1"], "run_id": "run-1", "tool": "update_task_status", "risk": "L2",
                          "args": {"task_key": "PM-12", "status": "COMPLETED"}, "decision": "approve",
                          "http_status": 200, "summary": "PM-12「登录页接入短信验证」"}
    assert "jwt" not in str(audit.tool_calls)


async def _pg_available(dsn: str) -> bool:
    try:
        import psycopg
        conn = await psycopg.AsyncConnection.connect(dsn, connect_timeout=2)
        await conn.close()
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.mark.pg
async def test_migration_is_idempotent_and_pg_audit_writes():
    dsn = get_settings().agent_db_url
    if not await _pg_available(dsn):
        pytest.skip("本地 PG 不可达，跳过 PG 审计测试")
    import psycopg
    sql = MIGRATION.read_text()
    async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
        await conn.execute(sql)
        await conn.execute(sql)   # 第二次执行不报错
    audit = PgAudit(dsn, schema="agent")
    await audit.setup()          # 内部再执行一次迁移，也必须幂等
    try:
        await audit.start_run("r-pg", "t_acme_7_pg", "acme", 7, "输入")
        await audit.tool_call("r-pg", "c1", "update_task_status", "L2", {"task_key": "PM-12"}, "approve", 200, "ok", 5)
        await audit.end_run("r-pg", "ok", 10, None)
        await audit.flag_run("r-pg", "UNVERIFIED_NEGATIVE_CLAIM")
        await audit.flag_run("r-pg", "CREATE_THEN_DELETE:delete_task:PM-12")
        await audit.flag_run("r-missing", "X")   # 不存在的 run：无事发生、不抛
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            cur = await conn.execute("select status, tokens, flags from agent.runs where run_id=%s", ("r-pg",))
            assert await cur.fetchone() == ("ok", 10, ["UNVERIFIED_NEGATIVE_CLAIM", "CREATE_THEN_DELETE:delete_task:PM-12"])
            cur = await conn.execute("select tool, risk, decision, http_status, args->>'task_key' from agent.tool_calls where run_id=%s", ("r-pg",))
            assert await cur.fetchone() == ("update_task_status", "L2", "approve", 200, "PM-12")
            await conn.execute("delete from agent.tool_calls where run_id=%s", ("r-pg",))
            await conn.execute("delete from agent.runs where run_id=%s", ("r-pg",))
            await conn.commit()
    finally:
        await audit.close()
