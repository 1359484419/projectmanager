"""MCP 子应用（app/mcp）：mcp 2.x 客户端经 ASGI 直连 FastAPI 上挂载的 /mcp（无状态 Streamable HTTP + JSON 响应）。

覆盖：tools/list 清单与 schema 纪律（additionalProperties:false、总字符上限、无内部 id 参数、title/annotations/outputSchema）；
缺网关头 → isError 且无堆栈；create_tasks dry_run 不发 POST；旧形参（projectKey/target/taskSeq）与新形参等价；
L3 无 confirm → isError；输出不含内部 id；LLM/DB 初始化失败时 /mcp 仍可用且 /health 分开报告；resources / prompts。
"""
import json
from contextlib import asynccontextmanager

import httpx
import httpx2
import pytest
import respx
from langgraph.checkpoint.memory import InMemorySaver
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.harness.audit import MemoryAudit
from app.main import create_app
from app.settings import get_settings
from tests._fx import BASE, fx, mock_common, ok
from tests.fake_llm import FakeLLM

H = {"Authorization": "Bearer pmt_x", "X-PM-Tenant": "acme", "X-PM-User": "7"}

CORE_TOOLS = {
    "list_projects", "get_project_overview", "list_my_work", "get_task", "search_tasks", "get_board", "list_members",
    "create_tasks", "add_comment", "create_subtask", "update_task_status", "update_task", "move_task_to_sprint",
    "close_sprint", "start_sprint",
}
ALIAS_TOOLS = {"list_sprints", "list_epics", "list_my_tasks"}   # 旧 Java 名；另三个旧名与新名相同（同工具兼容旧形参）
SCHEMA_CHARS_LIMIT = 12000


def make_app(llm=None):
    return create_app(settings=get_settings(), llm=llm, checkpointer=InMemorySaver(), audit=MemoryAudit())


@asynccontextmanager
async def mcp_session(app, headers: dict | None = H, *, run_lifespan: bool = True):
    """经 ASGI 直连 /mcp；缺省先跑 lifespan（MCP 会话管理器在 lifespan 里启动）。"""
    async def _body():
        http = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://agent",
                                  headers=headers or {})
        async with http:
            async with streamable_http_client("http://agent/mcp", http_client=http) as (read, write, *_):
                async with ClientSession(read, write) as s:
                    await s.initialize()
                    yield s

    if run_lifespan:
        async with app.router.lifespan_context(app):
            async for s in _body():
                yield s
    else:
        async for s in _body():
            yield s


def _text(res) -> str:
    return "".join(c.text for c in res.content if getattr(c, "type", "") == "text")


def _walk_objects(node, out):
    if isinstance(node, dict):
        if node.get("type") == "object" or "properties" in node:
            out.append(node)
        for v in node.values():
            _walk_objects(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_objects(v, out)


# ---------- tools/list ----------

async def test_tools_list_catalog_and_schema_discipline():
    async with mcp_session(make_app()) as s:
        init_ok = True
        tools = (await s.list_tools()).tools
    assert init_ok
    names = {t.name for t in tools}
    assert names == CORE_TOOLS | ALIAS_TOOLS
    assert len(tools) == len(CORE_TOOLS) + len(ALIAS_TOOLS)
    total = 0
    for t in tools:
        assert t.title, t.name
        assert t.description and any("一" <= ch <= "鿿" for ch in t.description), f"{t.name} 描述应为中文"
        assert t.output_schema is not None, f"{t.name} 缺 outputSchema"
        assert t.annotations is not None, f"{t.name} 缺 annotations"
        objs: list[dict] = []
        _walk_objects(t.input_schema, objs)
        assert objs, t.name
        for o in objs:
            assert o.get("additionalProperties") is False, f"{t.name} 的对象 schema 缺 additionalProperties:false: {o}"
        assert "title" not in t.input_schema, t.name
        dumped = json.dumps(t.input_schema, ensure_ascii=False)
        for bad in ("slug", "tenant", "\"id\"", "tenantId", "assigneeId", "epicId", "sprintId"):
            assert bad not in dumped, f"{t.name} 参数含内部字段 {bad}"
        total += len(dumped)
    assert total <= SCHEMA_CHARS_LIMIT, f"tools/list 入参 schema 总字符 {total} > {SCHEMA_CHARS_LIMIT}"


async def test_tool_annotations_by_risk():
    async with mcp_session(make_app()) as s:
        by = {t.name: t for t in (await s.list_tools()).tools}
    for n in ("list_projects", "get_project_overview", "list_my_work", "get_task", "search_tasks", "get_board",
              "list_members", "list_sprints", "list_epics", "list_my_tasks"):
        assert by[n].annotations.read_only_hint is True, n
    for n in ("close_sprint", "start_sprint"):
        a = by[n].annotations
        assert a.destructive_hint is True and a.read_only_hint is False, n
        assert by[n].input_schema["properties"]["confirm"]["type"] == "boolean"
        assert "confirm" in by[n].input_schema["required"]
        assert "展示" in by[n].description, f"{n} 描述应要求先向用户展示影响"
    for n in ("update_task_status", "update_task", "move_task_to_sprint"):
        assert by[n].annotations.idempotent_hint is True and by[n].annotations.destructive_hint is False, n
    for n in ("create_tasks", "add_comment", "create_subtask"):
        assert by[n].annotations.read_only_hint is False and by[n].annotations.destructive_hint is False, n
    items = by["create_tasks"].input_schema["properties"]["tasks"]
    assert items["maxItems"] == 20


async def test_mcp_exact_path_and_trailing_slash_both_serve_without_redirect():
    app = make_app()
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as c:
            for path in ("/mcp", "/mcp/"):
                r = await c.post(path, json=body, headers={"Accept": "application/json, text/event-stream"})
                assert r.status_code == 200, (path, r.status_code)
                assert r.headers["content-type"].startswith("application/json")       # json_response，无 SSE
                assert "mcp-session-id" not in {k.lower() for k in r.headers}         # stateless
                assert r.json()["result"]["serverInfo"]["name"] == "kuibu"
                assert "confirm=true" in r.json()["result"]["instructions"]


# ---------- 网关头 ----------

async def test_missing_gateway_headers_is_error_without_trace():
    async with mcp_session(make_app(), headers={"Authorization": "Bearer pmt_x"}) as s:
        res = await s.call_tool("list_projects", {})
    assert res.is_error is True
    body = json.loads(_text(res))
    assert body["code"] == "BAD_GATEWAY_HEADERS" and "X-PM-Tenant" in body["message"]
    assert "Traceback" not in _text(res) and "File \"" not in _text(res)


@respx.mock
async def test_internal_exception_is_error_without_trace(monkeypatch):
    mock_common()
    respx.get(f"{BASE}/members").mock(side_effect=RuntimeError("boom secret"))
    async with mcp_session(make_app()) as s:
        res = await s.call_tool("list_members", {})
    assert res.is_error is True
    text = _text(res)
    assert "boom secret" not in text and "Traceback" not in text
    assert json.loads(text)["code"] == "INTERNAL"


# ---------- 读工具与输出清洗 ----------

@respx.mock
async def test_list_projects_and_get_task_outputs_have_no_internal_ids():
    mock_common()
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([
        {"id": 1, "taskId": 112, "title": "写用例", "done": True, "createdAt": "2026-09-21T00:00:00Z"}]))
    respx.get(f"{BASE}/tasks/112/comments").mock(return_value=ok([
        {"id": 9, "taskId": 112, "authorId": 8, "body": "已联调", "createdAt": "2026-09-22T00:00:00Z"}]))
    async with mcp_session(make_app()) as s:
        projects = await s.call_tool("list_projects", {})
        task = await s.call_tool("get_task", {"task_key": "pm-12"})
    assert projects.is_error is not True
    assert projects.structured_content["projects"][0] == {"key": "PM", "name": "跬步", "defaultSprintLength": "WEEK_2",
                                                          "autoRotate": True}
    assert task.is_error is not True
    t = task.structured_content["task"]
    assert t["displayKey"] == "PM-12" and t["assigneeName"] == "张三" and t["epicName"] == "登录改造"
    assert t["sprintName"] == "Sprint 2"
    dumped = json.dumps(task.structured_content)
    for bad in ("assigneeId", "epicId", "sprintId", "projectId", "\"id\"", "authorId", "createdBy", "rank"):
        assert bad not in dumped, bad
    assert task.structured_content["comments"][0]["authorName"] == "张三"


@respx.mock
async def test_get_project_overview_merges_sprints_epics_dashboard():
    mock_common()
    respx.get(f"{BASE}/projects/PM/dashboard").mock(return_value=ok({
        "sprint": {"id": 30, "name": "Sprint 2", "startDate": "2026-09-21", "endDate": "2026-10-04", "daysLeft": 10},
        "counts": {"TODO": 1, "IN_PROGRESS": 1, "COMPLETED": 0, "DONE": 1}, "donePct": 33.3,
        "groups": {"TODO": [{"id": 115, "seq": 15, "title": "写周报"}]}}))
    async with mcp_session(make_app()) as s:
        res = await s.call_tool("get_project_overview", {"project_key": "pm"})
    assert res.is_error is not True, _text(res)
    d = res.structured_content
    assert d["projectKey"] == "PM" and d["projectName"] == "跬步"
    assert d["currentSprint"]["name"] == "Sprint 2" and d["nextSprint"]["name"] == "Sprint 3"
    assert d["lastClosedSprint"]["name"] == "Sprint 1"
    assert d["counts"] == {"TODO": 1, "IN_PROGRESS": 1, "COMPLETED": 0, "DONE": 1} and d["donePct"] == 33.3
    assert [e["name"] for e in d["epics"]] == ["登录改造", "登录安全", "报表"]
    assert "groups" not in d and "\"id\"" not in json.dumps(d)


@respx.mock
async def test_get_project_overview_without_sprints_passes_output_schema():
    """真后端回归：没有迭代时三个 sprint 字段为 null，outputSchema 必须允许（客户端会校验 structuredContent）。"""
    mock_common()
    respx.get(f"{BASE}/projects/OPS/sprints").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/OPS/epics").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/OPS/dashboard").mock(return_value=ok({"sprint": None, "counts": None, "donePct": 0.0,
                                                                       "groups": None}))
    async with mcp_session(make_app()) as s:
        res = await s.call_tool("get_project_overview", {"project_key": "OPS"})
    d = res.structured_content
    assert res.is_error is not True and d["currentSprint"] is None and d["nextSprint"] is None
    assert d["lastClosedSprint"] is None and d["counts"] is None and d["epics"] == []


def _mock_my_work():
    """两个项目：PM 有当前迭代看板 + 待办；OPS 没有迭代。"""
    mock_common()
    respx.get(f"{BASE}/projects/OPS/sprints").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/OPS/backlog").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/OPS/epics").mock(return_value=ok([]))
    respx.get(f"{BASE}/sprints/30/board").mock(return_value=ok("board"))
    respx.get(f"{BASE}/sprints/31/board").mock(return_value=ok({"sprint": {"id": 31}, "columns": {"TODO": []}}))
    respx.get(f"{BASE}/sprints/29/board").mock(return_value=ok({"sprint": {"id": 29}, "columns": {"DONE": [
        {"id": 100, "seq": 1, "title": "上迭代做完的", "type": "TASK", "status": "DONE", "points": 1, "assigneeId": 7}]}}))
    t115 = {"id": 115, "projectId": 1, "seq": 15, "displayKey": "PM-15", "type": "TASK", "title": "写周报",
            "description": "x" * 300, "points": 0.5, "epicId": 7, "sprintId": 30, "assigneeId": 7, "status": "TODO",
            "rank": "n", "createdAt": "2026-09-21T01:00:00Z", "updatedAt": "2026-09-24T01:00:00Z", "doneAt": None,
            "createdBy": 7}
    t110 = {**t115, "id": 110, "seq": 10, "displayKey": "PM-10", "title": "初始化仓库", "description": None,
            "points": 1, "epicId": None, "status": "DONE", "updatedAt": "2026-09-25T02:00:00Z",
            "doneAt": "2026-09-25T02:00:00Z"}
    t100 = {**t115, "id": 100, "seq": 1, "displayKey": "PM-1", "title": "上迭代做完的", "description": None,
            "epicId": None, "sprintId": 29, "status": "DONE", "updatedAt": "2026-09-18T02:00:00Z",
            "doneAt": "2026-09-18T02:00:00Z"}
    for t in (t115, t110, t100):
        respx.get(f"{BASE}/tasks/{t['id']}").mock(return_value=ok(t))
    respx.get(f"{BASE}/tasks/115/subtasks").mock(return_value=ok([{"id": 1, "title": "a", "done": True},
                                                                   {"id": 2, "title": "b", "done": False}]))
    respx.get(f"{BASE}/tasks/110/subtasks").mock(return_value=ok([]))
    respx.get(f"{BASE}/tasks/100/subtasks").mock(return_value=ok([]))
    respx.get(f"{BASE}/tasks/113/subtasks").mock(return_value=ok([]))


@respx.mock
async def test_list_my_work_scopes_and_fields():
    _mock_my_work()
    async with mcp_session(make_app()) as s:
        cur = await s.call_tool("list_my_work", {"scope": "current"})
        allw = await s.call_tool("list_my_work", {"scope": "all"})
        done_today = await s.call_tool("list_my_work", {"scope": "all", "done_since": "2026-09-25"})
        prev = await s.call_tool("list_my_work", {"scope": "previous", "project_key": "PM"})
    assert cur.is_error is not True, _text(cur)
    rows = cur.structured_content["tasks"]
    assert [r["displayKey"] for r in rows] == ["PM-15", "PM-10"]          # 只有我的（张三的 PM-12 不在）
    r15 = rows[0]
    assert r15["title"] == "写周报" and r15["type"] == "TASK" and r15["status"] == "TODO" and r15["points"] == 0.5
    assert r15["projectKey"] == "PM" and r15["sprintName"] == "Sprint 2" and r15["epicName"] == "报表"
    assert r15["doneAt"] is None and r15["updatedAt"] == "2026-09-24T01:00:00Z"
    assert len(r15["description"]) == 200 and r15["subtaskDone"] == 1 and r15["subtaskTotal"] == 2
    assert rows[1]["doneAt"] == "2026-09-25T02:00:00Z" and rows[1]["epicName"] is None
    assert "assigneeId" not in json.dumps(cur.structured_content)
    assert sorted(cur.structured_content["projects"]) == ["OPS", "PM"]     # 缺省跨项目

    keys = [r["displayKey"] for r in allw.structured_content["tasks"]]
    assert keys == ["PM-15", "PM-10", "PM-1", "PM-13"]                        # current + previous + backlog（next 无我的）
    assert [r["displayKey"] for r in done_today.structured_content["tasks"]] == ["PM-10"]
    assert [r["displayKey"] for r in prev.structured_content["tasks"]] == ["PM-1"]
    assert prev.structured_content["projects"] == ["PM"]


@respx.mock
async def test_list_my_work_all_covers_every_closed_sprint_not_only_the_latest():
    """审查 2026-09-25 MCP #6：scope=all 必须遍历全部已关闭迭代，否则 done_since 补周报永远拿不到更早的任务。"""
    _mock_my_work()
    sprints = fx("sprints") + [{"id": 28, "projectId": 1, "name": "Sprint 0", "length": "WEEK_2",
                                "startDate": "2026-08-24", "endDate": "2026-09-06", "status": "CLOSED", "tasks": None}]
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok(sprints))
    respx.get(f"{BASE}/sprints/28/board").mock(return_value=ok({"sprint": {"id": 28}, "columns": {"DONE": [
        {"id": 90, "seq": 90, "title": "更早迭代做完的", "type": "TASK", "status": "DONE", "points": 2, "assigneeId": 7},
        {"id": 91, "seq": 91, "title": "别人的", "type": "TASK", "status": "DONE", "points": 1, "assigneeId": 8}]}}))
    t90 = {"id": 90, "projectId": 1, "seq": 90, "displayKey": "PM-90", "type": "TASK", "title": "更早迭代做完的",
           "description": None, "points": 2, "epicId": None, "sprintId": 28, "assigneeId": 7, "status": "DONE",
           "rank": "n", "createdAt": "2026-08-25T01:00:00Z", "updatedAt": "2026-09-04T02:00:00Z",
           "doneAt": "2026-09-04T02:00:00Z", "createdBy": 7}
    respx.get(f"{BASE}/tasks/90").mock(return_value=ok(t90))
    respx.get(f"{BASE}/tasks/90/subtasks").mock(return_value=ok([]))
    async with mcp_session(make_app()) as s:
        allw = await s.call_tool("list_my_work", {"scope": "all"})
        prev = await s.call_tool("list_my_work", {"scope": "previous", "project_key": "PM"})
        since = await s.call_tool("list_my_work", {"scope": "all", "done_since": "2026-09-01"})
    assert allw.is_error is not True, _text(allw)
    keys = [r["displayKey"] for r in allw.structured_content["tasks"]]
    assert keys == ["PM-15", "PM-10", "PM-1", "PM-90", "PM-13"]      # current + 全部 CLOSED（新→旧）+ backlog
    assert [r["displayKey"] for r in prev.structured_content["tasks"]] == ["PM-1"]   # previous 仍只取最近关闭的一个
    assert [r["displayKey"] for r in since.structured_content["tasks"]] == ["PM-10", "PM-1", "PM-90"]
    assert allw.structured_content["tasks"][3]["sprintName"] == "Sprint 0"


# ---------- create_tasks ----------

@respx.mock
async def test_create_tasks_dry_run_sends_no_post_and_resolves_names():
    mock_common()
    post = respx.post(f"{BASE}/projects/PM/tasks").mock(return_value=ok({"id": 1}))
    async with mcp_session(make_app()) as s:
        res = await s.call_tool("create_tasks", {
            "project_key": "PM", "sprint": "current", "dry_run": True,
            "tasks": [{"title": "接入短信", "type": "STORY", "points": 1.5, "assignee": "张三", "epic": "登录改造"},
                      {"title": "自己的"},
                      {"title": "坏负责人", "assignee": "王五"}]})
    assert post.call_count == 0
    assert res.is_error is not True, _text(res)
    d = res.structured_content
    assert d["dryRun"] is True and d["projectKey"] == "PM" and d["sprintName"] == "Sprint 2"
    assert d["created"] == []
    prev = d["preview"]
    assert prev[0] == {"index": 0, "title": "接入短信", "type": "STORY", "points": 1.5, "assigneeName": "张三",
                       "epicName": "登录改造", "description": None}
    assert prev[1]["assigneeName"] == "李雷" and prev[1]["type"] == "TASK"     # 缺省指派给自己 → 显示名
    assert d["failed"] == [{"index": 2, "title": "坏负责人", "code": "NOT_FOUND", "message": "成员「王五」不存在"}]


@respx.mock
async def test_create_tasks_dry_run_unassigned_leaves_assignee_empty():
    mock_common()
    async with mcp_session(make_app()) as s:
        res = await s.call_tool("create_tasks", {"project_key": "PM", "dry_run": True,
                                                 "tasks": [{"title": "留空", "unassigned": True}]})
    assert res.structured_content["preview"][0]["assigneeName"] is None
    assert res.structured_content["sprintName"] == "待办"


@respx.mock
async def test_create_tasks_old_and_new_params_equivalent():
    mock_common()
    bodies: list[dict] = []

    def _create(request):
        body = json.loads(request.content)
        bodies.append(body)
        return httpx.Response(200, json={"id": 200 + len(bodies), "seq": 20 + len(bodies),
                                         "displayKey": f"PM-{20 + len(bodies)}", "title": body["title"],
                                         "type": body["type"], "status": "TODO", "assigneeId": body.get("assigneeId"),
                                         "sprintId": body.get("sprintId")})

    respx.post(f"{BASE}/projects/PM/tasks").mock(side_effect=_create)
    tasks = [{"type": "TASK", "title": "A"}, {"type": "BUG", "title": "B", "points": 1}]
    async with mcp_session(make_app()) as s:
        old = await s.call_tool("create_tasks", {"projectKey": "PM", "target": "current_sprint", "tasks": tasks})
        new = await s.call_tool("create_tasks", {"project_key": "PM", "sprint": "current", "tasks": tasks})
    assert old.is_error is not True, _text(old)
    assert new.is_error is not True, _text(new)
    assert bodies[0] == bodies[2] == {"type": "TASK", "title": "A", "assigneeId": 7, "sprintId": 30}
    assert bodies[1] == bodies[3] == {"type": "BUG", "title": "B", "points": 1.0, "assigneeId": 7, "sprintId": 30}
    for res in (old, new):
        d = res.structured_content
        assert d["dryRun"] is False and d["failed"] == [] and len(d["created"]) == 2
        assert d["created"][0]["title"] == "A" and d["created"][0]["displayKey"].startswith("PM-")
        assert "assigneeId" not in json.dumps(d) and "sprintId" not in json.dumps(d)


@respx.mock
async def test_create_tasks_partial_failure_reports_created_and_failed():
    mock_common()
    calls = {"n": 0}

    def _create(request):
        calls["n"] += 1
        if calls["n"] == 2:
            return httpx.Response(400, json={"code": "VALIDATION", "message": "标题过长"})
        return httpx.Response(200, json={"id": 300, "seq": 30, "displayKey": "PM-30", "type": "TASK", "status": "TODO",
                                         "title": json.loads(request.content)["title"]})

    respx.post(f"{BASE}/projects/PM/tasks").mock(side_effect=_create)
    async with mcp_session(make_app()) as s:
        res = await s.call_tool("create_tasks", {"project_key": "PM", "tasks": [
            {"title": "一"}, {"title": "二"}, {"title": "三"}]})
    d = res.structured_content
    assert res.is_error is not True
    assert [c["title"] for c in d["created"]] == ["一", "三"]
    assert d["failed"] == [{"index": 1, "title": "二", "code": "VALIDATION", "message": "标题过长"}]


async def test_create_tasks_rejects_unknown_item_field_and_over_20():
    async with mcp_session(make_app()) as s:
        r1 = await s.call_tool("create_tasks", {"project_key": "PM", "tasks": [{"title": "x", "assigneeId": 3}]})
        r2 = await s.call_tool("create_tasks", {"project_key": "PM", "tasks": [{"title": f"t{i}"} for i in range(21)]})
    assert r1.is_error is True and "assigneeId" in _text(r1)
    assert r2.is_error is True and "20" in _text(r2)


# ---------- 旧名别名 ----------

@respx.mock
async def test_alias_tools_map_old_params():
    _mock_my_work()
    patched: list[dict] = []
    respx.patch(f"{BASE}/tasks/112").mock(side_effect=lambda req: (patched.append(json.loads(req.content)),
                                                                   httpx.Response(200, json={**fx("task_12"), "status": "COMPLETED"}))[1])
    async with mcp_session(make_app()) as s:
        sprints = await s.call_tool("list_sprints", {"projectKey": "PM"})
        epics = await s.call_tool("list_epics", {"projectKey": "PM"})
        mine = await s.call_tool("list_my_tasks", {"projectKey": "PM", "sprint": "current"})
        old = await s.call_tool("update_task_status", {"taskSeq": "PM-12", "status": "COMPLETED"})
        new = await s.call_tool("update_task_status", {"task_key": "PM-12", "status": "COMPLETED"})
    assert [x["name"] for x in sprints.structured_content["sprints"]] == ["Sprint 3", "Sprint 2", "Sprint 1"]
    assert "projectId" not in json.dumps(sprints.structured_content)
    assert [e["name"] for e in epics.structured_content["epics"]] == ["登录改造", "登录安全", "报表"]
    assert [t["seq"] for t in mine.structured_content["tasks"]] == ["PM-15", "PM-10"]
    assert patched == [{"status": "COMPLETED"}, {"status": "COMPLETED"}]
    for res in (old, new):
        assert res.is_error is not True, _text(res)
        assert res.structured_content["task"]["status"] == "COMPLETED"
        assert res.structured_content["task"]["assigneeName"] == "张三"
        assert "assigneeId" not in json.dumps(res.structured_content)


# ---------- L3 ----------

@respx.mock
async def test_close_sprint_requires_confirm_true():
    mock_common()
    close = respx.post(f"{BASE}/sprints/30/close").mock(return_value=ok({"id": 30, "name": "Sprint 2", "status": "CLOSED"}))
    async with mcp_session(make_app()) as s:
        none = await s.call_tool("close_sprint", {"project_key": "PM", "sprint": "current", "unfinished": "backlog"})
        false = await s.call_tool("close_sprint", {"project_key": "PM", "sprint": "current", "unfinished": "backlog",
                                                   "confirm": False})
        assert close.call_count == 0
        yes = await s.call_tool("close_sprint", {"project_key": "PM", "sprint": "current", "unfinished": "backlog",
                                                 "confirm": True})
    # 缺 confirm 与 confirm=false 一视同仁：都是 CONFIRM_REQUIRED（SKILL.md 承诺），不是泛化的 VALIDATION
    assert none.is_error is True and json.loads(_text(none))["code"] == "CONFIRM_REQUIRED"
    assert false.is_error is True and json.loads(_text(false))["code"] == "CONFIRM_REQUIRED"
    assert yes.is_error is not True and close.call_count == 1
    assert yes.structured_content["sprint"] == {"name": "Sprint 2", "status": "CLOSED"}


@respx.mock
async def test_start_sprint_requires_confirm():
    mock_common()
    start = respx.post(f"{BASE}/sprints/31/start").mock(return_value=ok({"id": 31, "name": "Sprint 3", "status": "ACTIVE"}))
    async with mcp_session(make_app()) as s:
        no = await s.call_tool("start_sprint", {"project_key": "PM", "sprint": "Sprint 3"})
        assert no.is_error is True and start.call_count == 0
        assert json.loads(_text(no))["code"] == "CONFIRM_REQUIRED"
        yes = await s.call_tool("start_sprint", {"project_key": "PM", "sprint": "Sprint 3", "confirm": True})
    assert yes.is_error is not True and start.call_count == 1
    assert yes.structured_content["sprint"] == {"name": "Sprint 3", "status": "ACTIVE"}


# ---------- 业务错误 ----------

@respx.mock
async def test_not_found_and_ambiguous_are_structured_errors():
    mock_common()
    respx.get(f"{BASE}/tasks/search").mock(
        side_effect=lambda req: ok("search_pm12") if req.url.params.get("q") == "PM-12" else ok([]))
    async with mcp_session(make_app()) as s:
        nf = await s.call_tool("get_task", {"task_key": "PM-999"})
        amb = await s.call_tool("update_task", {"task_key": "PM-12", "assignee": "张"})
        bad = await s.call_tool("get_task", {"task_key": "12"})
    assert nf.is_error is True and json.loads(_text(nf)) == {"code": "NOT_FOUND",
                                                           "message": "任务 PM-999 不存在，可用 search_tasks 查找"}
    a = json.loads(_text(amb))
    assert amb.is_error is True and a["code"] == "AMBIGUOUS" and sorted(a["candidates"]) == ["张三", "张伟"]
    assert bad.is_error is True and json.loads(_text(bad))["code"] == "NOT_FOUND"


# ---------- 与 LLM / DB 解耦 ----------

async def test_mcp_available_when_llm_and_graph_init_fail(monkeypatch):
    import app.main as main_mod

    def _boom(*a, **k):
        raise RuntimeError("gateway config missing")

    monkeypatch.setattr(main_mod, "make_llm", _boom)
    app = make_app(llm=None)
    async with mcp_session(app) as s:
        tools = (await s.list_tools()).tools
        res = await s.call_tool("list_projects", {})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as c:
            health = (await c.get("/health")).json()
            threads = await c.post("/assistant/threads", headers={**H, "X-PM-Project": "PM"})
    assert len(tools) == len(CORE_TOOLS) + len(ALIAS_TOOLS)
    assert res.is_error is True and json.loads(_text(res))["code"] in ("CONNECTION_ERROR", "TIMEOUT")   # 后端不通，但工具可调
    assert health["mcp"] == "ok" and health["llm"] == "unreachable" and health["status"] == "degraded"
    assert threads.status_code == 503 and threads.json()["code"] == "ASSISTANT_UNAVAILABLE"


async def test_health_reports_mcp_ok_with_fake_llm():
    app = make_app(FakeLLM([]))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as c:
            assert (await c.get("/health")).json() == {"status": "ok", "llm": "ok", "mcp": "ok"}


# ---------- resources / prompts ----------

@respx.mock
async def test_resources_and_prompts():
    _mock_my_work()
    async with mcp_session(make_app()) as s:
        listed = (await s.list_resources()).resources
        templates = (await s.list_resource_templates()).resource_templates
        projects = await s.read_resource("pm://projects")
        current = await s.read_resource("pm://projects/PM/sprints/current")
        mine = await s.read_resource("pm://me/work")
        prompts = (await s.list_prompts()).prompts
        daily = await s.get_prompt("daily_report", {"project_key": "PM"})
        weekly = await s.get_prompt("weekly_report", {})
        plan = await s.get_prompt("plan_from_notes", {"notes": "修了登录 bug；写了周报"})
    assert {str(r.uri) for r in listed} == {"pm://projects", "pm://me/work"}
    assert [t.uri_template for t in templates] == ["pm://projects/{key}/sprints/current"]
    assert json.loads(projects.contents[0].text)["projects"][0]["key"] == "PM"
    board = json.loads(current.contents[0].text)
    assert board["sprint"]["name"] == "Sprint 2" and "\"id\"" not in current.contents[0].text
    assert [t["displayKey"] for t in json.loads(mine.contents[0].text)["tasks"]] == ["PM-15", "PM-10", "PM-1", "PM-13"]
    assert {p.name for p in prompts} == {"daily_report", "weekly_report", "plan_from_notes"}
    d = daily.messages[0].content.text
    assert "list_my_work" in d and "日报" in d and "project_key=\"PM\"" in d
    assert "周报" in weekly.messages[0].content.text and "previous" in weekly.messages[0].content.text
    p = plan.messages[0].content.text
    assert "修了登录 bug" in p and "dry_run" in p and "create_tasks" in p
