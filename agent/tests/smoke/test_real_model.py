"""真模型冒烟（plan Task 10 Step 2）：对已启动的 Python 服务直调，模拟 Java 反代注入的 header。

前置：agent/.env（真实网关凭证 + PM_API_URL 指向已启动的后端）、`uv run uvicorn app.main:app --port 8090` 已在跑。
运行：`cd agent && uv run pytest -m real_llm -q tests/smoke`（默认 `uv run pytest` 通过 addopts 排除本文件）。
无 .env / 后端或服务不可达 → 整个模块 skip。断言只看语义与副作用（工具事件、Java 里的状态、Activity source=AGENT），不绑固定文案。
"""
import base64
import json
import os
import uuid
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.real_llm

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
AGENT_URL = os.environ.get("PM_AGENT_URL", "http://localhost:8090")
PROJECT_KEY = "SMK"
TASK_TITLE = "补充注册页单元测试"


def _read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _jwt_subject(token: str) -> int:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return int(json.loads(base64.urlsafe_b64decode(payload))["sub"])


def _reachable(url: str) -> bool:
    try:
        return httpx.get(url, timeout=5, trust_env=False).status_code == 200
    except httpx.HTTPError:
        return False


class Backend:
    """后端 REST 小客户端：验证副作用用（与助手走的是同一套 API）。"""

    def __init__(self, base: str, slug: str, jwt: str):
        self.base, self.slug, self.jwt = base.rstrip("/"), slug, jwt
        self.http = httpx.Client(timeout=15, trust_env=False, headers={"Authorization": f"Bearer {jwt}"})

    def call(self, method: str, path: str, **kw):
        r = self.http.request(method, f"{self.base}/api/t/{self.slug}{path}", **kw)
        assert r.status_code < 300, f"{method} {path} -> {r.status_code} {r.text}"
        return r.json() if r.text else None

    def find_task(self, title: str) -> dict | None:
        rows = self.call("GET", f"/projects/{PROJECT_KEY}/backlog") or []
        return next((t for t in rows if t.get("title") == title), None)

    def task(self, task_id: int) -> dict:
        return self.call("GET", f"/tasks/{task_id}")


class Agent:
    """对 Python 服务直调，header 形式与 Java 反代注入的一致（Authorization / X-PM-Tenant / X-PM-User / X-PM-Project）。"""

    def __init__(self, base: str, slug: str, user_id: int, jwt: str):
        self.base = base.rstrip("/")
        self.headers = {"Authorization": f"Bearer {jwt}", "X-PM-Tenant": slug, "X-PM-User": str(user_id),
                        "X-PM-Project": PROJECT_KEY}
        self.http = httpx.Client(timeout=150, trust_env=False, headers=self.headers)
        r = self.http.post(f"{self.base}/assistant/threads")
        assert r.status_code == 200, r.text
        self.thread_id = r.json()["threadId"]

    def _sse(self, path: str, body: dict) -> list[dict]:
        events: list[dict] = []
        with self.http.stream("POST", f"{self.base}/assistant/threads/{self.thread_id}{path}", json=body) as r:
            assert r.status_code == 200, r.read().decode()
            assert r.headers["content-type"].startswith("text/event-stream")
            for line in r.iter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[len("data:"):].strip()))
        return events

    def say(self, text: str) -> list[dict]:
        return self._sse("/messages", {"text": text})

    def resume(self, decisions: list[dict]) -> list[dict]:
        return self._sse("/resume", {"decisions": decisions})


def text_of(events: list[dict]) -> str:
    return "".join(e.get("text", "") for e in events if e["type"] == "text_delta")


def types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


def tools_started(events: list[dict]) -> list[str]:
    return [e["tool"] for e in events if e["type"] == "tool_start"]


def confirm_of(events: list[dict]) -> dict:
    confirms = [e for e in events if e["type"] == "confirm"]
    assert len(confirms) == 1, f"期望恰好一张确认卡，实际事件：{types(events)}\n文本：{text_of(events)}"
    assert events[-1]["type"] == "confirm", "确认卡必须是流的最后一个事件（interrupt 即停流）"
    return confirms[0]


@pytest.fixture(scope="module")
def world():
    """注册临时租户 + 建项目；一个模块共用一个会话线程（用例 3-5 依赖前面创建的任务）。"""
    if not ENV_FILE.exists():
        pytest.skip("agent/.env 不存在：真模型冒烟需要真实网关凭证")
    env = _read_env(ENV_FILE)
    backend_url = env.get("PM_API_URL", "http://127.0.0.1:8080")
    if not _reachable(f"{backend_url}/api/health"):
        pytest.skip(f"后端不可达：{backend_url}")
    if not _reachable(f"{AGENT_URL}/health"):
        pytest.skip(f"助手服务不可达：{AGENT_URL}（先 uv run uvicorn app.main:app --port 8090）")
    health = httpx.get(f"{AGENT_URL}/health", timeout=5, trust_env=False).json()
    if health.get("llm") != "ok":
        pytest.skip(f"模型网关不可达：{health}")

    slug = f"smk-{uuid.uuid4().hex[:10]}"
    r = httpx.post(f"{backend_url}/api/auth/register", timeout=15, trust_env=False, json={
        "email": f"{slug}@example.com", "password": "secret123", "displayName": "冒烟用户",
        "tenantName": "冒烟租户", "tenantSlug": slug})
    assert r.status_code == 200, r.text
    jwt = r.json()["accessToken"]
    backend = Backend(backend_url, slug, jwt)
    backend.call("POST", "/projects", json={"key": PROJECT_KEY, "name": "冒烟项目"})
    return {"backend": backend, "agent": Agent(AGENT_URL, slug, _jwt_subject(jwt), jwt), "task": None}


# 1. 查询：必须真的调了 list_projects 才能回答，并以 done 结束
def test_1_list_projects_calls_tool(world):
    events = world["agent"].say("我有哪些项目")
    assert "list_projects" in tools_started(events), types(events)
    assert events[-1]["type"] == "done", types(events)
    assert events[-1]["usage"]["promptTokens"] > 0
    assert PROJECT_KEY in text_of(events) or "冒烟项目" in text_of(events)


# 2. 创建（L1）：直接执行并回显结果卡；Java 里任务存在且活动来源为 AGENT
def test_2_create_task_result_card_and_agent_activity(world):
    events = world["agent"].say(f"在待办建一个任务：{TASK_TITLE}，2 天")
    assert "create_task" in tools_started(events), types(events)
    assert "confirm" not in types(events), "创建类不该弹确认卡"
    cards = [e for e in events if e["type"] == "result_card"]
    assert len(cards) == 1, types(events)
    card = cards[0]["card"]
    assert card["key"].startswith(f"{PROJECT_KEY}-") and card["undoable"] is True
    assert cards[0]["callId"], "result_card 事件要带 callId"
    assert events[-1]["type"] == "done"

    task = world["backend"].find_task(TASK_TITLE)
    assert task is not None, "Java 待办里没有该任务"
    assert task["displayKey"] == card["key"] and float(task["points"]) == 2.0
    acts = world["backend"].call("GET", f"/tasks/{task['id']}/activities")
    assert any(a["source"] == "AGENT" for a in acts), acts
    world["task"] = task


# 3. 状态变更（L2）：确认卡 after=IN_PROGRESS；approve → tool_result ok；Java 状态已变
def test_3_update_status_confirm_then_approve(world):
    task = world["task"]
    assert task, "依赖用例 2"
    events = world["agent"].say(f"把 {task['displayKey']} 改成进行中")
    confirm = confirm_of(events)
    card = confirm["card"]
    assert card["tool"] == "update_task_status" and card["risk"] == "L2"
    assert card["changes"][0]["after"] == "IN_PROGRESS" and card["changes"][0]["before"] == "TODO"
    assert task["displayKey"] in card["target"]
    # 挂起期间 Java 未被改动
    assert world["backend"].task(task["id"])["status"] == "TODO"

    events = world["agent"].resume([{"callId": confirm["callId"], "type": "approve"}])
    results = [e for e in events if e["type"] == "tool_result" and e["callId"] == confirm["callId"]]
    assert results and results[0]["ok"] is True, types(events)
    assert events[-1]["type"] == "done", types(events)
    assert world["backend"].task(task["id"])["status"] == "IN_PROGRESS"


# 4. 不存在的展示号：不出确认卡、不猜，如实说不存在
def test_4_delete_nonexistent_no_confirm(world):
    events = world["agent"].say(f"把 {PROJECT_KEY}-999 删掉")
    assert "confirm" not in types(events), types(events)
    assert events[-1]["type"] == "done", types(events)
    assert "不存在" in text_of(events) or "找不到" in text_of(events), text_of(events)


# 5. 指代 + 术语表：「标记完成」→ COMPLETED（不是 DONE）；reject → 状态不变
def test_5_mark_complete_uses_glossary_then_reject(world):
    task = world["task"]
    assert task, "依赖用例 2"
    events = world["agent"].say("把它标记完成")
    confirm = confirm_of(events)
    card = confirm["card"]
    assert card["tool"] == "update_task_status"
    assert task["displayKey"] in card["target"], card
    assert card["changes"][0]["after"] == "COMPLETED", card["changes"]

    events = world["agent"].resume([{"callId": confirm["callId"], "type": "reject"}])
    assert events[-1]["type"] == "done", types(events)
    assert "confirm" not in types(events), "被拒绝后模型不得重发同一调用"
    assert world["backend"].task(task["id"])["status"] == "IN_PROGRESS"
