import httpx, pytest, respx
from app.harness.auth import RequestCtx, set_ctx, reset_ctx
from app.tools import _resolve as r
from app.tools._resolve import NotFound, Ambiguous
from tests._fx import BASE, CTX, fx, ok, mock_common


@pytest.fixture(autouse=True)
def _ctx():
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


# ---------- 任务展示号 ----------

@respx.mock
async def test_resolve_task_exact_match_only():
    mock_common()
    t = await r.resolve_task("PM-12")
    assert t["displayKey"] == "PM-12" and t["id"] == 112
    # search 命中 PM-120 与 PM-12，只取完全相等的那条
    t = await r.resolve_task("pm-12")  # 大小写不敏感
    assert t["id"] == 112


@respx.mock
async def test_resolve_task_falls_back_to_project_lists_when_search_misses():
    mock_common()
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok([]))  # 标题不含展示号 → 搜索搜不到
    t = await r.resolve_task("PM-13")
    assert t["displayKey"] == "PM-13" and t["id"] == 113


@respx.mock
async def test_resolve_task_via_sprint_tasks():
    mock_common()
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok([]))
    sprints = fx("sprints")
    sprints[1]["tasks"] = fx("board")["columns"]["IN_PROGRESS"]
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok(sprints))
    t = await r.resolve_task("PM-12")
    assert t["id"] == 112


@respx.mock
async def test_resolve_task_not_found_does_not_guess():
    mock_common()
    with pytest.raises(NotFound) as e:
        await r.resolve_task("PM-99")
    assert "PM-99" in e.value.message and "search_tasks" in e.value.message


@respx.mock
async def test_resolve_task_unknown_project():
    mock_common()
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok([]))
    respx.get(f"{BASE}/projects/ZZ/sprints").mock(return_value=httpx.Response(404, json={"code": "NOT_FOUND", "message": "x"}))
    with pytest.raises(NotFound) as e:
        await r.resolve_task("ZZ-1")
    assert "ZZ" in e.value.message


async def test_resolve_task_bad_format():
    with pytest.raises(NotFound):
        await r.resolve_task("登录页")


# ---------- 成员 ----------

@respx.mock
async def test_resolve_member_ambiguous():
    mock_common()
    with pytest.raises(Ambiguous) as e:
        await r.resolve_member("张")
    assert e.value.candidates == ["张三", "张伟"]
    assert "张三" not in str(e.value)          # 候选名只在 candidates 里（R2 #5）


@respx.mock
async def test_resolve_member_self_aliases_and_exact():
    mock_common()
    for alias in ("我", "me", "自己"):
        assert (await r.resolve_member(alias))["userId"] == 7
    assert (await r.resolve_member("张三"))["userId"] == 8
    assert (await r.resolve_member("zhangwei"))["userId"] == 9      # 邮箱前缀
    assert (await r.resolve_member("LiLei@example.com"))["userId"] == 7
    with pytest.raises(NotFound):
        await r.resolve_member("王五")


# ---------- 迭代 ----------

@respx.mock
async def test_resolve_sprint_keywords_and_names():
    mock_common()
    assert (await r.resolve_sprint("current", "PM"))["id"] == 30
    assert (await r.resolve_sprint("next", "PM"))["id"] == 31
    assert (await r.resolve_sprint("backlog", "PM"))["id"] is None
    assert (await r.resolve_sprint("sprint 1", "PM"))["id"] == 29
    with pytest.raises(Ambiguous):
        await r.resolve_sprint("Sprint", "PM")
    with pytest.raises(NotFound):
        await r.resolve_sprint("Sprint 9", "PM")


@respx.mock
async def test_resolve_sprint_next_missing_hints_create():
    mock_common()
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok([s for s in fx("sprints") if s["status"] != "PLANNED"]))
    with pytest.raises(NotFound) as e:
        await r.resolve_sprint("next", "PM")
    assert "create_sprint" in e.value.message
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok([]))
    with pytest.raises(NotFound):
        await r.resolve_sprint("current", "PM")


# ---------- 项目 / 长期计划 ----------

@respx.mock
async def test_resolve_project_key():
    mock_common()
    assert await r.resolve_project_key(None) == "PM"          # ctx.project_key
    assert await r.resolve_project_key("ops") == "OPS"        # 显式，大小写不敏感
    with pytest.raises(NotFound):
        await r.resolve_project_key("NOPE")
    token = set_ctx(RequestCtx(jwt="j", tenant="acme", user_id=7, project_key=None, page=None))
    try:
        with pytest.raises(Ambiguous) as ei:                   # 无上下文项目且有多个项目 → 候选让模型追问，不自动挑第一个
            await r.resolve_project_key(None)
        assert ei.value.candidates == ["PM", "OPS"]
        respx.get(f"{BASE}/projects").mock(return_value=ok([fx("projects")[0]]))
        assert await r.resolve_project_key(None) == "PM"      # 只有一个项目才自动取
        respx.get(f"{BASE}/projects").mock(return_value=ok([]))
        with pytest.raises(NotFound):
            await r.resolve_project_key(None)
    finally:
        reset_ctx(token)


@respx.mock
async def test_resolve_epic():
    mock_common()
    assert (await r.resolve_epic("报表", "PM"))["id"] == 7
    assert (await r.resolve_epic("登录改造", "PM"))["id"] == 5
    with pytest.raises(Ambiguous) as e:
        await r.resolve_epic("登录", "PM")
    assert e.value.candidates == ["登录改造", "登录安全"]
    with pytest.raises(NotFound):
        await r.resolve_epic("支付", "PM")


@respx.mock
async def test_ambiguous_message_has_no_candidate_names():
    """候选名是用户数据：只放 candidates（act 包进 <data>），不拼进文案（R2 #5）。"""
    mock_common()
    with pytest.raises(Ambiguous) as e:
        await r.resolve_member("张")
    assert e.value.candidates == ["张三", "张伟"]
    assert "张三" not in e.value.message and "张伟" not in e.value.message
    assert "成员「张」" in e.value.message
    with pytest.raises(Ambiguous) as e2:
        await r.resolve_epic("登录", "PM")
    assert e2.value.candidates == ["登录改造", "登录安全"] and "登录改造" not in e2.value.message
