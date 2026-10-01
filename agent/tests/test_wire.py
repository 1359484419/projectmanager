"""工具输出清洗（评审 2026-09-25 P2 · Q8/R4）：模型只见展示号与名称，不见内部数字 id。

app/tools/_wire.py 是通用清洗层，供面板助手与后续 MCP 复用。
"""
import pytest
import respx

from app.harness import tool_guard as tg
from app.harness.auth import reset_ctx, set_ctx
from app.tools import catalog
from app.tools._wire import INTERNAL_KEYS, NameIndex, strip_internal, task_to_wire
from tests._fx import BASE, CTX, fx, mock_common, ok


@pytest.fixture(autouse=True)
def _env():
    catalog.load_all()
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


async def run(tool: str, **args):
    spec = tg.REGISTRY[tool]
    return await spec.fn(spec.params(**args))


def test_task_to_wire_resolves_names_and_drops_internal_ids():
    idx = NameIndex(members=fx("members"), epics=fx("epics"), sprints=fx("sprints"))
    out = task_to_wire(fx("task_12"), idx)
    assert out["displayKey"] == "PM-12" and out["title"] == "登录页接入短信验证"
    assert out["assigneeName"] == "张三" and out["epicName"] == "登录改造" and out["sprintName"] == "Sprint 2"
    for k in ("id", "projectId", "sprintId", "assigneeId", "epicId", "rank", "createdBy", "version"):
        assert k not in out, k
    # 未指派 / 无长期计划 / 待办 → 名称为 None（而不是消失，模型能看出「没有」）
    bare = task_to_wire({**fx("task_12"), "assigneeId": None, "epicId": None, "sprintId": None}, idx)
    assert bare["assigneeName"] is None and bare["epicName"] is None and bare["sprintName"] is None
    # 解析不到（成员已移除）→ None，不把数字 id 透出去
    gone = task_to_wire({**fx("task_12"), "assigneeId": 999}, idx)
    assert gone["assigneeName"] is None and "assigneeId" not in gone


def test_strip_internal_is_recursive_and_keeps_display_fields():
    data = {"id": 1, "taskId": 2, "authorId": 3, "displayKey": "XX-0", "items": [{"id": 4, "title": "t", "sprintId": 5}]}
    out = strip_internal(data)
    assert out == {"displayKey": "XX-0", "items": [{"title": "t"}]}
    assert {"id", "taskId", "authorId", "sprintId", "projectId", "assigneeId", "epicId", "createdBy"} <= INTERNAL_KEYS


@respx.mock
async def test_get_task_returns_names_not_ids_for_task_subtasks_and_comments():
    mock_common()
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([{"id": 1, "taskId": 112, "title": "写用例", "done": False}]))
    respx.get(f"{BASE}/tasks/112/comments").mock(return_value=ok([{"id": 2, "taskId": 112, "authorId": 7, "body": "ok",
                                                                    "createdAt": "2026-09-20T01:00:00Z"}]))
    got = await run("get_task", task_key="PM-12")
    t = got["task"]
    assert t["displayKey"] == "PM-12" and t["assigneeName"] == "张三" and t["epicName"] == "登录改造"
    assert t["sprintName"] == "Sprint 2"
    for k in ("id", "projectId", "sprintId", "assigneeId", "epicId", "createdBy", "rank"):
        assert k not in t, k
    assert got["subtasks"] == [{"title": "写用例", "done": False}]
    assert got["comments"] == [{"authorName": "李雷", "body": "ok", "createdAt": "2026-09-20T01:00:00Z"}]


@respx.mock
async def test_get_task_subtask_detail_ids_become_names():
    """子任务新字段（assigneeId/doneBy）一律换姓名，内部数字 id 不透给模型（评审：_wire 缺 doneBy）。"""
    mock_common()
    respx.get(f"{BASE}/tasks/112/subtasks").mock(return_value=ok([
        {"id": 1, "taskId": 112, "title": "写用例", "done": True, "description": "覆盖边界",
         "assigneeId": 7, "dueDate": "2026-10-01", "doneAt": "2026-09-28T02:00:00Z", "doneBy": 8,
         "rank": "b0000000001", "createdAt": "2026-09-20T01:00:00Z"},
        {"id": 2, "taskId": 112, "title": "没人领", "done": False,
         "assigneeId": None, "dueDate": None, "doneAt": None, "doneBy": None},
        {"id": 3, "taskId": 112, "title": "离职成员", "done": True, "assigneeId": 999, "doneBy": 999},
    ]))
    respx.get(f"{BASE}/tasks/112/comments").mock(return_value=ok([]))
    got = await run("get_task", task_key="PM-12")
    subs = got["subtasks"]
    assert subs[0]["assigneeName"] == "李雷" and subs[0]["doneByName"] == "张三"
    assert subs[0]["description"] == "覆盖边界" and subs[0]["dueDate"] == "2026-10-01"
    for s in subs:
        for k in ("id", "taskId", "assigneeId", "doneBy", "rank"):
            assert k not in s, k
    # 未指派 → None（模型看得出「没有」）；解析不到 → None，不透数字 id
    assert subs[1]["assigneeName"] is None and subs[1]["doneByName"] is None
    assert subs[2]["assigneeName"] is None and subs[2]["doneByName"] is None


@respx.mock
async def test_list_backlog_and_my_tasks_and_board_items_are_cleaned():
    mock_common()
    respx.get(f"{BASE}/sprints/30/board").mock(return_value=ok("board"))
    bl = await run("list_backlog")
    assert [t["displayKey"] for t in bl["tasks"]] == ["PM-13", "PM-14"]
    assert bl["tasks"][0]["assigneeName"] == "李雷" and bl["tasks"][1]["assigneeName"] == "张三"
    assert all("assigneeId" not in t and "id" not in t and "projectId" not in t for t in bl["tasks"])
    mine = await run("list_my_tasks", sprint="backlog")
    assert [t["displayKey"] for t in mine["tasks"]] == ["PM-13"] and "assigneeId" not in mine["tasks"][0]
    cur = await run("list_my_tasks", sprint="current")
    assert [t["displayKey"] for t in cur["tasks"]] == ["PM-15", "PM-10"]
    assert all("assigneeId" not in t and "id" not in t for t in cur["tasks"])
    assert cur["tasks"][0]["assigneeName"] == "李雷"
    board = await run("get_board")
    flat = [t for col in board["columns"].values() for t in col]
    assert all("assigneeId" not in t and "id" not in t for t in flat)
    assert "id" not in board["sprint"] and "projectId" not in board["sprint"] and board["sprint"]["name"] == "Sprint 2"
