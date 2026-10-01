"""act 节点的幂等与续跑（评审 #2/#5/#9）：

- 超时打断 act 后以 None 续跑，已发出的写操作不重发（回 UNKNOWN_OUTCOME 让用户核对）。
- 写操作 401 → 图在 reauth 节点挂起（token_expired），刷新后 resume：已 200 的写不重放，401 的那条重新执行（后端从未受理，不算重试）。
- 刷新后 resume 时确认卡已过期 → act 的第二道门拒绝（CARD_EXPIRED），不执行。
"""
import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx
import respx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.graph import build_graph
from app.settings import get_settings
from tests._fx import BASE, fx, mock_common, ok
from tests.fake_llm import FakeLLM, calls, text, tool_call
from tests.test_graph import Clock, NOW, _ctx, idle, pending_card, status_call, tool_msgs, user  # noqa: F401

_ = _ctx


def cfg(tid: str, attempt: str) -> dict:
    """每次 HTTP 请求对应一个 attempt（API 层 thread_config 生成）；act 据此区分"本次标记"与"上次中断遗留的标记"。"""
    return {"configurable": {"thread_id": tid, "attempt": attempt}}


def make(llm, *, clock=None, settings=None):
    return build_graph(llm=llm, settings=settings or get_settings(), checkpointer=InMemorySaver(),
                       now_fn=clock or Clock(NOW))


async def drain(g, inp, config, timeout: float | None = None):
    async with asyncio.timeout(timeout):
        async for _ in g.astream(inp, config, stream_mode=["updates", "custom"]):
            pass


@respx.mock
async def test_timeout_interrupted_write_is_not_re_executed():
    mock_common()
    received = []

    async def slow_create(request):
        received.append(json.loads(request.read()))
        await asyncio.sleep(0.4)
        return ok({**fx("backlog")[0], "displayKey": "PM-58", "title": "新任务"})

    post = respx.post(f"{BASE}/projects/PM/tasks").mock(side_effect=slow_create)
    llm = FakeLLM([calls(tool_call("create_task", {"type": "TASK", "title": "新任务"}, "c1")), text("完成")])
    g = make(llm)
    try:
        await drain(g, user("建个任务"), cfg("t1", "a1"), timeout=0.2)
    except TimeoutError:
        pass
    assert len(received) == 1                        # 请求已发出，服务端可能已落库（respx 对被取消的请求不计数，用自记的）
    st = await g.aget_state(cfg("t1", "a1"))
    assert st.next == ("act",)
    await g.ainvoke(None, cfg("t1", "a2"))           # 前端"同句重发"= 新 attempt 续跑
    st = await g.aget_state(cfg("t1", "a2"))
    assert idle(st) and len(received) == 1 and post.call_count == 0   # 不重发
    tm = tool_msgs(st, "c1")
    assert len(tm) == 1 and "UNKNOWN_OUTCOME" in tm[0]["content"] and "核对" in tm[0]["content"]


@respx.mock
async def test_token_expired_mid_act_resumes_without_replaying_done_writes():
    mock_common()
    p12 = respx.patch(f"{BASE}/tasks/112").mock(return_value=ok({**fx("task_12"), "status": "COMPLETED"}))
    p13 = respx.patch(f"{BASE}/tasks/113").mock(side_effect=[
        httpx.Response(401, json={"code": "UNAUTHORIZED", "message": "expired"}),
        ok({**fx("backlog")[0], "status": "DONE"})])
    llm = FakeLLM([calls(status_call("PM-12", "COMPLETED", "c1"), status_call("PM-13", "DONE", "c2")), text("都好了")])
    g = make(llm)
    await g.ainvoke(user("x"), cfg("t2", "a1"))
    await g.ainvoke(Command(resume={"type": "approve"}), cfg("t2", "a1"))
    await g.ainvoke(Command(resume={"type": "approve"}), cfg("t2", "a2"))
    st = await g.aget_state(cfg("t2", "a2"))
    # 第二条写 401：在 reauth 节点挂起，值为 token_expired，而不是抛异常丢掉 c1 的结果
    assert st.interrupts and st.interrupts[0].value == {"type": "token_expired"}
    assert p12.call_count == 1 and p13.call_count == 1
    assert tool_msgs(st) == []
    await g.ainvoke(Command(resume=True), cfg("t2", "a3"))   # 刷新令牌后原样重发
    st = await g.aget_state(cfg("t2", "a3"))
    assert idle(st)
    assert p12.call_count == 1 and p13.call_count == 2       # 已成功的不重放；401 的那条重新执行
    assert '"status": "COMPLETED"' in tool_msgs(st, "c1")[0]["content"]
    assert '"status": "DONE"' in tool_msgs(st, "c2")[0]["content"]
    assert st.values["messages"][-1]["content"] == "都好了"


@respx.mock
async def test_stale_approval_is_rejected_by_act_after_reauth():
    mock_common()
    d = respx.delete(f"{BASE}/tasks/112").mock(side_effect=[
        httpx.Response(401, json={"code": "UNAUTHORIZED", "message": "expired"}), httpx.Response(204)])
    clock = Clock(NOW)
    llm = FakeLLM([calls(tool_call("delete_task", {"task_key": "PM-12"}, "c1")), text("未执行")])
    g = make(llm, clock=clock)
    await g.ainvoke(user("删掉 PM-12"), cfg("t3", "a1"))
    await g.ainvoke(Command(resume={"type": "approve"}), cfg("t3", "a2"))
    st = await g.aget_state(cfg("t3", "a2"))
    assert st.interrupts[0].value == {"type": "token_expired"} and d.call_count == 1
    clock.now = NOW + timedelta(days=1)                       # 一天后才刷新重发
    await g.ainvoke(Command(resume=True), cfg("t3", "a3"))
    st = await g.aget_state(cfg("t3", "a3"))
    assert idle(st) and d.call_count == 1                     # 过期审批不执行
    tm = tool_msgs(st, "c1")
    assert len(tm) == 1 and "CARD_EXPIRED" in tm[0]["content"]


@respx.mock
async def test_reads_that_hit_401_are_re_run_after_reauth():
    mock_common()
    projects = respx.get(f"{BASE}/projects").mock(side_effect=[
        httpx.Response(401, json={"code": "UNAUTHORIZED", "message": "expired"}), ok("projects")])
    llm = FakeLLM([calls(tool_call("list_projects", {}, "c1")), text("2 个项目")])
    g = make(llm)
    await g.ainvoke(user("我有哪些项目"), cfg("t4", "a1"))
    st = await g.aget_state(cfg("t4", "a1"))
    assert st.interrupts[0].value == {"type": "token_expired"}
    await g.ainvoke(Command(resume=True), cfg("t4", "a2"))
    st = await g.aget_state(cfg("t4", "a2"))
    assert idle(st) and projects.call_count == 2
    assert '"key": "PM"' in tool_msgs(st, "c1")[0]["content"]


# ---------- 评审 2026-09-25 P1-1（M5/X5）：edit 决策执行后 tool 消息必须告诉模型「参数已被用户改过」 ----------

@respx.mock
async def test_edit_result_tells_model_user_changed_args_and_second_reason_sees_it():
    from app.nodes.act import EDITED_PREFIX
    mock_common()
    patch = respx.patch(f"{BASE}/tasks/112").mock(return_value=ok({**fx("task_12"), "points": 2.0}))
    llm = FakeLLM([calls(tool_call("update_task", {"task_key": "PM-12", "points": 3.0}, "c1")), text("已改为 2 天")])
    g = make(llm)
    await g.ainvoke(user("PM-12 改成 3 天"), cfg("t5", "a1"))
    await g.ainvoke(Command(resume={"type": "edit", "args": {"points": 2.0}}), cfg("t5", "a2"))
    st = await g.aget_state(cfg("t5", "a2"))
    assert idle(st) and patch.call_count == 1
    assert json.loads(patch.calls.last.request.read()) == {"points": 2.0}
    tm = tool_msgs(st, "c1")
    assert len(tm) == 1
    content = tm[0]["content"]
    # 固定模板在前，用户改过的参数与结果各自包在 <data> 里
    assert content.startswith(EDITED_PREFIX)
    assert "用户在确认卡上把参数改为" in content and "已执行" in content
    assert "这是用户的最终意图" in content and "不要按原参数重发" in content
    head, _, rest = content.partition("</data>")
    assert '"points": 2.0' in head and '"task_key": "PM-12"' in head
    assert '"displayKey": "PM-12"' in rest and rest.count("<data>") == 1
    # 第二轮 reason 的 tool 消息里能看到该提示
    second = llm.calls[1]["messages"]
    seen = [m for m in second if m.get("role") == "tool" and m.get("tool_call_id") == "c1"]
    assert len(seen) == 1 and seen[0]["content"].startswith(EDITED_PREFIX)
    # approve 的结果不带该前缀（只有 edit 才有）
    llm2 = FakeLLM([calls(tool_call("update_task", {"task_key": "PM-12", "points": 3.0}, "c2")), text("ok")])
    g2 = make(llm2)
    await g2.ainvoke(user("PM-12 改成 3 天"), cfg("t5b", "a1"))
    await g2.ainvoke(Command(resume={"type": "approve"}), cfg("t5b", "a2"))
    st2 = await g2.aget_state(cfg("t5b", "a2"))
    assert tool_msgs(st2, "c2")[0]["content"].startswith("<data>")


def test_edited_tool_message_is_still_ok_for_frontend_history():
    """threads.simplify_messages 用 tool 消息判 ok：带 edit 前缀的成功结果仍是 ok=True。"""
    from app.api.threads import simplify_messages
    from app.nodes.act import CallResult, tool_message
    m = tool_message("c1", CallResult(ok=True, data={"displayKey": "XX-0"}, decision="edit",
                                      args={"task_key": "XX-0", "points": 2.0}, tool="update_task"))
    rows = simplify_messages([calls(tool_call("update_task", {"task_key": "XX-0", "points": 3.0}, "c1")), m])
    assert rows == [{"role": "tool", "call_id": "c1", "tool": "update_task", "ok": True}]


@respx.mock
async def test_act_next_sprint_missing_hints_create_sprint_not_web(_ctx):
    """页内助手有 create_sprint 工具：act 的错误 tool 消息追加「可先 create_sprint」，不出现 MCP 端的「网页」指引。"""
    from app.harness import tool_guard as tg
    from app.nodes.act import _execute, tool_message
    mock_common()
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok([s for s in fx("sprints") if s["status"] != "PLANNED"]))
    spec = tg.REGISTRY["move_task_to_sprint"]
    r = await _execute(spec, spec.params(task_key="PM-12", sprint="next"))
    assert r.ok is False and r.code == "NEXT_SPRINT_MISSING"
    assert r.message == "没有已计划的下一个迭代，可先 create_sprint"
    assert "所有迭代" not in r.message and "网页" not in r.message
    content = tool_message("c1", r)["content"]
    assert json.loads(content)["error"] == {"code": "NEXT_SPRINT_MISSING", "message": r.message}
    # 普通 NotFound 不受影响
    r2 = await _execute(spec, spec.params(task_key="PM-12", sprint="Sprint 9"))
    assert r2.code == "NOT_FOUND" and r2.message == "迭代「Sprint 9」不存在"
