import httpx, pytest, respx
from pydantic import ValidationError
from app.harness import tool_guard as tg
from app.harness.auth import set_ctx, reset_ctx
from app.tools import catalog
from app.tools._resolve import NotFound, Ambiguous
from tests._fx import BASE, CTX, fx, ok, mock_common


@pytest.fixture(autouse=True)
def _env():
    catalog.load_all()
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


async def run(tool: str, **args):
    spec = tg.REGISTRY[tool]
    return await spec.fn(spec.params(**args))


# ---------- 目录结构 ----------

def test_registry_matches_spec_catalog():
    assert set(tg.REGISTRY) == catalog.EXPECTED_TOOLS
    assert len(catalog.EXPECTED_TOOLS) == 33
    catalog.load_all()  # 幂等
    assert set(tg.REGISTRY) == catalog.EXPECTED_TOOLS


def test_risk_levels_match_spec():
    by_risk = {r: {n for n, s in tg.REGISTRY.items() if s.risk == r} for r in ("L0", "L1", "L2", "L3")}
    assert by_risk["L0"] == {"list_projects", "get_dashboard", "list_sprints", "get_board", "list_backlog",
                             "list_my_tasks", "get_task", "search_tasks", "list_epics", "list_members",
                             "list_notifications"}
    assert by_risk["L1"] == {"create_task", "create_subtask", "add_comment", "create_record", "create_sprint",
                             "create_epic", "mark_notifications_read", "dismiss_record_reminder"}
    assert by_risk["L2"] == {"update_task_status", "update_task", "move_task_to_sprint", "update_subtask",
                             "update_epic", "set_capacity"}
    assert by_risk["L3"] == {"delete_task", "delete_subtask", "delete_epic", "delete_sprint", "start_sprint",
                             "close_sprint", "invite_member", "remove_member"}


def test_l2_l3_have_summarize_and_l2_have_before():
    for name, spec in tg.REGISTRY.items():
        if spec.risk in ("L2", "L3"):
            assert spec.summarize is not None, name
        if spec.risk == "L2":
            assert spec.before is not None, name
            assert spec.editable, f"{name} 应声明 editable"
        if spec.risk == "L3":
            assert spec.editable == (), f"L3 工具 {name} 不允许 edit"


def test_all_params_forbid_extra():
    for name, spec in tg.REGISTRY.items():
        assert spec.params.model_config.get("extra") == "forbid", name


def _walk_property_names(node, out):
    if isinstance(node, dict):
        for k, v in node.get("properties", {}).items():
            out.append(k)
            _walk_property_names(v, out)
        for k, v in node.items():
            if k != "properties":
                _walk_property_names(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_property_names(v, out)


def test_openai_schema_has_no_internal_id_params():
    tools = tg.openai_tools()
    assert len(tools) == 33
    for t in tools:
        names = []
        _walk_property_names(t["function"]["parameters"], names)
        for n in names:
            assert n not in tg.FORBIDDEN_PARAM_NAMES, (t["function"]["name"], n)
            assert not n.endswith("_id") and not n.endswith("Id"), (t["function"]["name"], n)
        assert "title" not in t["function"]["parameters"]
        assert t["function"]["description"]


# ---------- L0 ----------

@respx.mock
async def test_list_projects_and_dashboard():
    mock_common()
    respx.get(f"{BASE}/projects/PM/dashboard").mock(return_value=ok({"sprint": None, "counts": None, "donePct": 0, "groups": None}))
    assert (await run("list_projects"))["projects"][0]["key"] == "PM"
    d = await run("get_dashboard")
    assert d["projectKey"] == "PM" and d["sprint"] is None
    respx.get(f"{BASE}/projects/PM/dashboard").mock(return_value=ok(
        {"sprint": {"id": 30, "name": "Sprint 2"}, "counts": {"TODO": 1}, "donePct": 0, "groups": fx("board")["columns"]}))
    d = await run("get_dashboard")
    flat = [t for col in d["groups"].values() for t in col]
    assert [t["displayKey"] for t in flat] == ["PM-15", "PM-12", "PM-10"] and all("id" not in t for t in flat)


@respx.mock
async def test_list_my_tasks_filters_by_current_user():
    mock_common()
    respx.get(f"{BASE}/sprints/30/board").mock(return_value=ok("board"))
    cur = await run("list_my_tasks", sprint="current")
    assert [t["seq"] for t in cur["tasks"]] == [15, 10]
    assert cur["tasks"][0]["status"] == "TODO"
    bl = await run("list_my_tasks", sprint="backlog")
    assert [t["displayKey"] for t in bl["tasks"]] == ["PM-13"]


@respx.mock
async def test_get_task_includes_subtasks_and_comments():
    mock_common()
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([{"id": 1, "taskId": 112, "title": "写用例", "done": False}]))
    respx.get(f"{BASE}/tasks/112/comments").mock(return_value=ok([{"id": 2, "taskId": 112, "authorId": 8, "body": "ok"}]))
    got = await run("get_task", task_key="PM-12")
    assert got["task"]["displayKey"] == "PM-12" and len(got["subtasks"]) == 1 and len(got["comments"]) == 1


@respx.mock
async def test_get_board_and_sprints_and_search():
    mock_common()
    respx.get(f"{BASE}/sprints/30/board").mock(return_value=ok("board"))
    b = await run("get_board")
    assert b["sprint"]["name"] == "Sprint 2"
    # 看板任务补展示号（模型只能按 XX-0 指代），不暴露内部 id（R2 low #1）
    flat = [t for col in b["columns"].values() for t in col]
    assert [t["displayKey"] for t in flat] == ["PM-15", "PM-12", "PM-10"]
    assert all("id" not in t for t in flat)
    route = respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok("sprints"))
    await run("list_sprints", with_tasks=True)
    assert route.calls.last.request.url.params["withTasks"] == "true"
    s = await run("search_tasks", q="登录")
    assert len(s["hits"]) == 2


# ---------- L1 ----------

@respx.mock
async def test_create_task_resolves_names_and_validates_points():
    mock_common()
    route = respx.post(f"{BASE}/projects/PM/tasks").mock(return_value=ok({**fx("task_12"), "displayKey": "PM-58"}))
    out = await run("create_task", type="TASK", title="补充注册页单元测试", points=2, assignee="张三",
                    epic_name="报表", sprint="current")
    body = route.calls.last.request.read()
    import json
    body = json.loads(body)
    assert body == {"type": "TASK", "title": "补充注册页单元测试", "points": 2.0, "assigneeId": 8, "epicId": 7, "sprintId": 30}
    assert out["displayKey"] == "PM-58"
    # backlog → 不带 sprintId
    await run("create_task", type="BUG", title="x", sprint="backlog")
    assert "sprintId" not in json.loads(route.calls.last.request.read())
    for bad in (0.3, 0, 5.5, 1.25):
        with pytest.raises(ValidationError):
            tg.REGISTRY["create_task"].params(type="TASK", title="x", points=bad)
    with pytest.raises(ValidationError):
        tg.REGISTRY["create_task"].params(type="RECORD", title="x")   # 记录走 create_record
    with pytest.raises(ValidationError):
        tg.REGISTRY["create_task"].params(type="TASK", title="x", sprintId=3)   # extra=forbid


def test_create_task_escalates_when_assigning_others():
    spec = tg.REGISTRY["create_task"]
    assert tg.effective_risk(spec, spec.params(type="TASK", title="x"), CTX) == "L1"
    assert tg.effective_risk(spec, spec.params(type="TASK", title="x", assignee="我"), CTX) == "L1"
    assert tg.effective_risk(spec, spec.params(type="TASK", title="x", assignee="张三"), CTX) == "L2"
    assert spec.summarize is not None


@respx.mock
async def test_create_record_truncates_title_and_normalizes_remind_at():
    mock_common()
    route = respx.post(f"{BASE}/projects/PM/tasks").mock(return_value=ok(fx("task_12")))
    content = "发票" * 60
    await run("create_record", content=content, remind_at="2026-09-25 09:00")
    import json
    body = json.loads(route.calls.last.request.read())
    assert body["type"] == "RECORD" and body["title"] == content[:80] and body["description"] == content
    assert body["remindAt"] == "2026-09-25T01:00:00Z"   # 无时区按 Asia/Shanghai 解释
    with pytest.raises(ValidationError):
        tg.REGISTRY["create_record"].params(content="x", remind_at="明天")


@respx.mock
async def test_create_subtask_comment_sprint_epic_and_notifications():
    mock_common()
    import json
    st = respx.post(f"{BASE}/tasks/112/subtasks").mock(return_value=ok({"id": 1, "title": "写用例", "done": False}))
    assert (await run("create_subtask", task_key="PM-12", title="写用例"))["title"] == "写用例"
    cm = respx.post(f"{BASE}/tasks/112/comments").mock(return_value=ok({"id": 2, "body": "好"}))
    await run("add_comment", task_key="PM-12", body="好")
    assert json.loads(cm.calls.last.request.read()) == {"body": "好"}
    sp = respx.post(f"{BASE}/projects/PM/sprints").mock(return_value=ok(fx("sprints")[0]))
    await run("create_sprint", length="WEEK_1", start_date="2026-10-05")
    assert json.loads(sp.calls.last.request.read()) == {"length": "WEEK_1", "startDate": "2026-10-05"}
    with pytest.raises(ValidationError):
        tg.REGISTRY["create_sprint"].params(start_date="10月5日")
    ep = respx.post(f"{BASE}/projects/PM/epics").mock(return_value=ok(fx("epics")[0]))
    await run("create_epic", name="支付", quarter="2026-Q4")
    assert json.loads(ep.calls.last.request.read()) == {"name": "支付", "quarter": "2026-Q4"}
    with pytest.raises(ValidationError):
        tg.REGISTRY["create_epic"].params(name="支付", quarter="Q4")
    respx.get(f"{BASE}/notifications").mock(return_value=ok({"unreadCount": 1, "items": []}))
    assert (await run("list_notifications"))["unreadCount"] == 1
    ra = respx.post(f"{BASE}/notifications/read-all").mock(return_value=httpx.Response(204))
    await run("mark_notifications_read")
    assert ra.called
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/PM/records").mock(return_value=ok([{**fx("task_12"), "id": 200, "seq": 20, "displayKey": "PM-20", "type": "RECORD"}]))
    respx.get(f"{BASE}/tasks/200").mock(return_value=ok({**fx("task_12"), "id": 200, "seq": 20, "displayKey": "PM-20", "type": "RECORD"}))
    dm = respx.post(f"{BASE}/records/200/dismiss").mock(return_value=httpx.Response(204))
    assert (await run("dismiss_record_reminder", record_key="PM-20"))["dismissed"] == "PM-20"
    assert dm.called


# ---------- L2 ----------

@respx.mock
async def test_update_task_status_reads_before_then_patches():
    mock_common()
    import json
    spec = tg.REGISTRY["update_task_status"]
    p = spec.params(task_key="PM-12", status="COMPLETED")
    before = await spec.before(p)
    assert before["status"] == "IN_PROGRESS"
    assert spec.summarize(p, before) == "修改任务状态 PM-12「登录页接入短信验证」"
    route = respx.patch(f"{BASE}/tasks/112").mock(return_value=ok({**fx("task_12"), "status": "COMPLETED"}))
    out = await spec.fn(p)
    assert json.loads(route.calls.last.request.read()) == {"status": "COMPLETED"}
    assert out["status"] == "COMPLETED"
    with pytest.raises(ValidationError):
        spec.params(task_key="PM-12", status="FINISHED")


@respx.mock
async def test_update_task_patchlong_semantics():
    mock_common()
    import json
    route = respx.patch(f"{BASE}/tasks/112").mock(return_value=ok("task_12"))
    await run("update_task", task_key="PM-12", title="新标题", clear_assignee=True)
    body = json.loads(route.calls.last.request.read())
    assert body == {"title": "新标题", "assigneeId": None}        # 显式 null = 置空；未提供的键不出现
    await run("update_task", task_key="PM-12", assignee="张伟", epic_name="报表", points=1.5)
    assert json.loads(route.calls.last.request.read()) == {"points": 1.5, "assigneeId": 9, "epicId": 7}
    await run("update_task", task_key="PM-12", clear_epic=True)
    assert json.loads(route.calls.last.request.read()) == {"epicId": None}
    with pytest.raises(ValidationError):
        tg.REGISTRY["update_task"].params(task_key="PM-12")          # 至少一个修改字段
    with pytest.raises(ValidationError):
        tg.REGISTRY["update_task"].params(task_key="PM-12", assignee="张三", clear_assignee=True)


@respx.mock
async def test_move_task_to_sprint_backlog_sends_explicit_null():
    mock_common()
    import json
    route = respx.patch(f"{BASE}/tasks/112").mock(return_value=ok("task_12"))
    await run("move_task_to_sprint", task_key="PM-12", sprint="backlog")
    assert json.loads(route.calls.last.request.read()) == {"sprintId": None}
    await run("move_task_to_sprint", task_key="PM-12", sprint="next")
    assert json.loads(route.calls.last.request.read()) == {"sprintId": 31}
    spec = tg.REGISTRY["move_task_to_sprint"]
    p = spec.params(task_key="PM-12", sprint="next")
    assert "PM-12" in spec.summarize(p, await spec.before(p))


@respx.mock
async def test_update_subtask_resolves_by_title():
    mock_common()
    import json
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([
        {"id": 1, "taskId": 112, "title": "写用例", "done": False},
        {"id": 2, "taskId": 112, "title": "写文档", "done": False},
        {"id": 3, "taskId": 112, "title": "写文档索引", "done": False}]))
    route = respx.patch(f"{BASE}/subtasks/1").mock(return_value=ok({"id": 1, "title": "写用例", "done": True}))
    await run("update_subtask", task_key="PM-12", subtask_title="写用例", done=True)
    assert json.loads(route.calls.last.request.read()) == {"done": True}
    with pytest.raises(Ambiguous):
        await run("update_subtask", task_key="PM-12", subtask_title="文档", done=True)
    respx.patch(f"{BASE}/subtasks/2").mock(return_value=ok({"id": 2}))
    await run("update_subtask", task_key="PM-12", subtask_title="写文档", new_title="写说明")  # 完全相等优先
    with pytest.raises(NotFound):
        await run("update_subtask", task_key="PM-12", subtask_title="不存在", done=True)
    spec = tg.REGISTRY["update_subtask"]
    p = spec.params(task_key="PM-12", subtask_title="写用例", done=True)
    assert (await spec.before(p))["done"] is False


@respx.mock
async def test_update_epic_and_set_capacity():
    mock_common()
    import json
    route = respx.patch(f"{BASE}/projects/PM/epics/7").mock(return_value=ok(fx("epics")[2]))
    await run("update_epic", epic_name="报表", status="DONE", quarter="2026-Q4")
    assert json.loads(route.calls.last.request.read()) == {"quarter": "2026-Q4", "status": "DONE"}
    respx.get(f"{BASE}/sprints/30/capacity").mock(return_value=ok([{"userId": 8, "displayName": "张三", "capacity": 8, "assignedPoints": 2}]))
    cap = respx.put(f"{BASE}/sprints/30/capacity/8").mock(return_value=ok({"userId": 8, "capacity": 5}))
    spec = tg.REGISTRY["set_capacity"]
    p = spec.params(member="张三", capacity=5)
    before = await spec.before(p)
    assert before["capacity"] == 8
    assert "张三" in spec.summarize(p, before)
    await spec.fn(p)
    assert json.loads(cap.calls.last.request.read()) == {"capacity": 5}
    with pytest.raises(NotFound):
        await run("set_capacity", sprint="backlog", member="张三", capacity=5)


# ---------- L3 ----------

@respx.mock
async def test_delete_tools_hit_resolved_ids():
    mock_common()
    d = respx.delete(f"{BASE}/tasks/112").mock(return_value=httpx.Response(204))
    out = await run("delete_task", task_key="PM-12")
    assert d.called and out["deleted"] == "PM-12"
    spec = tg.REGISTRY["delete_task"]
    assert "PM-12" in spec.summarize(spec.params(task_key="PM-12"), None)
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([{"id": 1, "taskId": 112, "title": "写用例", "done": False}]))
    ds = respx.delete(f"{BASE}/subtasks/1").mock(return_value=httpx.Response(204))
    await run("delete_subtask", task_key="PM-12", subtask_title="写用例")
    assert ds.called
    de = respx.delete(f"{BASE}/projects/PM/epics/7").mock(return_value=httpx.Response(204))
    await run("delete_epic", epic_name="报表")
    assert de.called
    dsp = respx.delete(f"{BASE}/sprints/31").mock(return_value=httpx.Response(204))
    await run("delete_sprint", sprint_name="Sprint 3")
    assert dsp.called
    with pytest.raises(NotFound):
        await run("delete_sprint", sprint_name="backlog")


@respx.mock
async def test_sprint_lifecycle_and_members():
    mock_common()
    import json
    st = respx.post(f"{BASE}/sprints/31/start").mock(return_value=ok({**fx("sprints")[0], "status": "ACTIVE"}))
    assert (await run("start_sprint", sprint_name="Sprint 3"))["status"] == "ACTIVE"
    cl = respx.post(f"{BASE}/sprints/30/close").mock(return_value=ok({**fx("sprints")[1], "status": "CLOSED"}))
    await run("close_sprint", unfinished="move", target_sprint="next")
    assert json.loads(cl.calls.last.request.read()) == {"unfinished": "MOVE", "targetSprintId": 31}
    await run("close_sprint", unfinished="backlog")
    assert json.loads(cl.calls.last.request.read()) == {"unfinished": "BACKLOG"}
    with pytest.raises(ValidationError):
        tg.REGISTRY["close_sprint"].params(unfinished="move")   # MOVE 必须给 target_sprint
    inv = respx.post(f"{BASE}/invites").mock(return_value=ok({"token": "t", "url": "http://x/accept?token=t", "expiresAt": "2026-10-01T00:00:00Z"}))
    assert (await run("invite_member", role="MEMBER"))["url"].startswith("http")
    assert json.loads(inv.calls.last.request.read()) == {"role": "MEMBER"}
    rm = respx.delete(f"{BASE}/members/9").mock(return_value=httpx.Response(200))
    out = await run("remove_member", member="张伟")
    assert rm.called and out["removed"] == "张伟"
    assert (await run("list_members"))["members"][0]["displayName"] == "李雷"
