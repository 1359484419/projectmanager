"""测试辅助：加载 fixtures、设置请求上下文、常用 respx 路由。"""
import json
import pathlib

import httpx
import respx

from app.harness.auth import RequestCtx

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
CTX = RequestCtx(jwt="jwt1", tenant="acme", user_id=7, project_key="PM", page=None)
BASE = "http://pm/api/t/acme"


def fx(name: str):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def ok(name_or_obj):
    body = fx(name_or_obj) if isinstance(name_or_obj, str) else name_or_obj
    return httpx.Response(200, json=body)


def mock_common():
    """项目/成员/迭代/长期计划/搜索/任务详情的基础路由（可被覆盖）。"""
    respx.get(f"{BASE}/projects").mock(return_value=ok("projects"))
    respx.get(f"{BASE}/members").mock(return_value=ok("members"))
    respx.get(f"{BASE}/projects/PM/sprints").mock(return_value=ok("sprints"))
    respx.get(f"{BASE}/projects/PM/epics").mock(return_value=ok("epics"))
    respx.get(f"{BASE}/projects/PM/backlog").mock(return_value=ok("backlog"))
    respx.get(f"{BASE}/projects/PM/records").mock(return_value=ok([]))
    respx.get(f"{BASE}/tasks/search").mock(return_value=ok("search_pm12"))
    respx.get(f"{BASE}/tasks/112").mock(return_value=ok("task_12"))
    respx.get(f"{BASE}/tasks/113").mock(return_value=ok(fx("backlog")[0]))
