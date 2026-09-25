"""观测打点（评审 2026-09-25 P1-2 / P1-3）：

- reason：无 tool_calls、文本命中「不存在|找不到|NOT_FOUND」且本轮没有任何 tool 消息 → 结构化日志 + 审计 runs 记 flag。
- observe：同一次运行里 create_X 之后紧跟 delete_X 同一对象 → 审计告警 flag（模型无端创建再删除）。
"""
import logging

import httpx
import pytest
import respx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.graph import build_graph
from app.harness.audit import MemoryAudit
from app.harness.auth import reset_ctx, set_ctx
from app.settings import get_settings
from tests._fx import BASE, CTX, fx, mock_common, ok
from tests.fake_llm import FakeLLM, calls, text, tool_call


@pytest.fixture(autouse=True)
def _ctx():
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


def _cfg(tid: str) -> dict:
    return {"configurable": {"thread_id": tid}}


def _user(txt: str, run_id: str = "run-1") -> dict:
    return {"messages": [{"role": "user", "content": txt}], "round": 0, "tokens_used": 0, "decisions": {}, "cards": {},
            "run_id": run_id, "conflict_retries": {}, "last_call_sigs": [], "error": None}


def _make(llm, audit):
    return build_graph(llm=llm, settings=get_settings(), checkpointer=InMemorySaver(), audit=audit)


async def test_memory_audit_flag_run_appends():
    a = MemoryAudit()
    await a.start_run("r1", "t", "acme", 7, "x")
    await a.flag_run("r1", "A")
    await a.flag_run("r1", "B")
    assert a.runs["r1"]["flags"] == ["A", "B"]
    await a.flag_run("r-unknown", "C")   # 未 start 的 run 也不抛
    assert a.runs["r-unknown"]["flags"] == ["C"]


async def test_negative_claim_without_tool_is_flagged(caplog):
    audit = MemoryAudit()
    await audit.start_run("run-1", "t1", "acme", 7, "把 XX-9 挪到下个迭代")
    llm = FakeLLM([text("XX-9 没有找到（返回 NOT_FOUND），无法操作。")])
    g = _make(llm, audit)
    with caplog.at_level(logging.WARNING, logger="pm.agent.reason"):
        await g.ainvoke(_user("把 XX-9 挪到下个迭代"), _cfg("t1"))
    assert "UNVERIFIED_NEGATIVE_CLAIM" in audit.runs["run-1"]["flags"]
    rec = next(r for r in caplog.records if "UNVERIFIED_NEGATIVE_CLAIM" in r.getMessage())
    assert getattr(rec, "run_id", None) == "run-1" and getattr(rec, "thread_id", None) == "t1"


@respx.mock
async def test_negative_claim_after_real_tool_result_is_not_flagged():
    mock_common()
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok("sprints"))
    audit = MemoryAudit()
    await audit.start_run("run-2", "t2", "acme", 7, "x")
    llm = FakeLLM([calls(tool_call("get_task", {"task_key": "PM-99"}, "c1")), text("PM-99 不存在，没找到这个任务号。")])
    g = _make(llm, audit)
    await g.ainvoke(_user("看看 PM-99", run_id="run-2"), _cfg("t2"))
    assert "UNVERIFIED_NEGATIVE_CLAIM" not in audit.runs["run-2"].get("flags", [])
    # 普通肯定回复也不打点
    await audit.start_run("run-3", "t3", "acme", 7, "x")
    g3 = _make(FakeLLM([text("你好，有什么可以帮你？")]), audit)
    await g3.ainvoke(_user("你好", run_id="run-3"), _cfg("t3"))
    assert audit.runs["run-3"].get("flags", []) == []


@respx.mock
async def test_create_then_delete_same_object_in_one_run_is_flagged():
    mock_common()
    respx.post(f"{BASE}/tasks/112/subtasks").mock(return_value=ok({"id": 9, "taskId": 112, "title": "占位", "done": False}))
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([{"id": 9, "taskId": 112, "title": "占位", "done": False}]))
    respx.delete(f"{BASE}/subtasks/9").mock(return_value=httpx.Response(204))
    audit = MemoryAudit()
    await audit.start_run("run-4", "t4", "acme", 7, "它算 2 天")
    llm = FakeLLM([calls(tool_call("create_subtask", {"task_key": "PM-12", "title": "占位"}, "c1")),
                   calls(tool_call("delete_subtask", {"task_key": "PM-12", "subtask_title": "占位"}, "c2")),
                   text("好了")])
    g = _make(llm, audit)
    await g.ainvoke(_user("它算 2 天", run_id="run-4"), _cfg("t4"))
    await g.ainvoke(Command(resume={"type": "approve"}), _cfg("t4"))
    flags = audit.runs["run-4"]["flags"]
    assert any(f.startswith("CREATE_THEN_DELETE") and "delete_subtask" in f and "占位" in f for f in flags), flags


@respx.mock
async def test_create_task_then_delete_task_by_returned_key_is_flagged_and_unrelated_delete_is_not():
    mock_common()
    respx.post(f"{BASE}/projects/PM/tasks").mock(return_value=ok({**fx("backlog")[0], "displayKey": "PM-58", "id": 158}))
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok([{"id": 158, "displayKey": "PM-58", "title": "新任务"},
                                                            {"id": 112, "displayKey": "PM-12", "title": "登录页接入短信验证"}]))
    respx.get(f"{BASE}/tasks/158").mock(return_value=ok({**fx("backlog")[0], "displayKey": "PM-58", "id": 158}))
    respx.delete(f"{BASE}/tasks/158").mock(return_value=httpx.Response(204))
    respx.delete(f"{BASE}/tasks/112").mock(return_value=httpx.Response(204))
    audit = MemoryAudit()
    await audit.start_run("run-5", "t5", "acme", 7, "x")
    llm = FakeLLM([calls(tool_call("create_task", {"title": "新任务"}, "c1")),
                   calls(tool_call("delete_task", {"task_key": "PM-58"}, "c2")), text("ok")])
    g = _make(llm, audit)
    await g.ainvoke(_user("x", run_id="run-5"), _cfg("t5"))
    await g.ainvoke(Command(resume={"type": "approve"}), _cfg("t5"))
    assert any(f.startswith("CREATE_THEN_DELETE") and "PM-58" in f for f in audit.runs["run-5"]["flags"])
    # 删除的是别的对象 → 不告警
    await audit.start_run("run-6", "t6", "acme", 7, "x")
    llm2 = FakeLLM([calls(tool_call("create_task", {"title": "新任务"}, "c1")),
                    calls(tool_call("delete_task", {"task_key": "PM-12"}, "c2")), text("ok")])
    g2 = _make(llm2, audit)
    await g2.ainvoke(_user("x", run_id="run-6"), _cfg("t6"))
    await g2.ainvoke(Command(resume={"type": "approve"}), _cfg("t6"))
    assert not any(f.startswith("CREATE_THEN_DELETE") for f in audit.runs["run-6"].get("flags", []))


async def test_positive_claim_without_tool_is_flagged_separately(caplog):
    """冒烟里实测到的变体：全新线程、零工具，模型回复「XX-0 已挪到下一个迭代」。肯定型也打点（独立 flag，便于分开统计）。"""
    audit = MemoryAudit()
    await audit.start_run("run-7", "t7", "acme", 7, "把 XX-9 挪到下个迭代")
    llm = FakeLLM([text("XX-9 已挪到下一个迭代。")])
    g = _make(llm, audit)
    with caplog.at_level(logging.WARNING, logger="pm.agent.reason"):
        await g.ainvoke(_user("把 XX-9 挪到下个迭代", run_id="run-7"), _cfg("t7"))
    assert audit.runs["run-7"]["flags"] == ["UNVERIFIED_POSITIVE_CLAIM"]
    assert any("UNVERIFIED_POSITIVE_CLAIM" in r.getMessage() for r in caplog.records)
    # 追问/说明类回复（没有"已 X"）不打点
    await audit.start_run("run-8", "t8", "acme", 7, "x")
    g8 = _make(FakeLLM([text("你要把它挪到哪个迭代？下一个还是指定名称？")]), audit)
    await g8.ainvoke(_user("把 XX-9 挪一下", run_id="run-8"), _cfg("t8"))
    assert audit.runs["run-8"]["flags"] == []
