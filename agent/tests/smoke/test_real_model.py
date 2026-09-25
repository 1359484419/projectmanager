"""真模型冒烟（plan Task 10 Step 2）：对已启动的 Python 服务直调，模拟 Java 反代注入的 header。

前置：agent/.env（真实网关凭证 + PM_API_URL 指向已启动的后端）、`uv run uvicorn app.main:app --port 8090` 已在跑。
运行：`cd agent && uv run pytest -m real_llm -q tests/smoke`（默认 `uv run pytest` 通过 addopts 排除本文件）。
无 .env / 后端或服务不可达 → 整个模块 skip。断言只看语义与副作用（工具事件、Java 里的状态、Activity source=AGENT），不绑固定文案。
"""
import base64
import json
import os
import re
import uuid
import warnings
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
    uid = _jwt_subject(jwt)
    return {"backend": backend, "agent": Agent(AGENT_URL, slug, uid, jwt), "task": None,
            "new_agent": lambda: Agent(AGENT_URL, slug, uid, jwt)}   # 多轮指代类用例各开新线程，避免历史串扰


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
    # 规则 8 要求用人话（"没找到这个任务号"），不绑固定措辞，只要求是否定型如实告知
    assert re.search(r"不存在|找不到|没找到|没有找到", text_of(events)), text_of(events)


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


# ---------- 评审 2026-09-25 多轮语义测试里的失败场景（断言只看工具序列/参数/后端副作用，不绑文案） ----------

INTERNAL_ID_RE = re.compile(r"(assignee|epic|sprint|project|author)Id|(用户|ID|id)\s*[:：]?\s*\d{1,6}\b")


def cards_of(events: list[dict]) -> list[dict]:
    return [e for e in events if e["type"] == "confirm"]


def reject_all(agent: Agent, events: list[dict]) -> list[dict]:
    """把本轮所有确认卡拒掉（状态不变），返回 resume 事件。"""
    cards = cards_of(events)
    return agent.resume([{"callId": c["callId"], "type": "reject"} for c in cards]) if cards else []


# 6. M5/X5：确认卡上改了参数并执行后，模型不得按原参数重发第二张卡，也不得说成未执行
def test_6_edit_decision_is_final_no_resend(world):
    task = world["task"]
    assert task, "依赖用例 2"
    events = world["agent"].say(f"把 {task['displayKey']} 改成 3 天")
    confirm = confirm_of(events)
    assert confirm["card"]["tool"] == "update_task" and confirm["card"]["args"]["points"] == 3.0
    events = world["agent"].resume([{"callId": confirm["callId"], "type": "edit", "args": {"points": 2.5}}])
    assert "confirm" not in types(events), f"edit 执行后不得再出卡：{types(events)}\n{text_of(events)}"
    results = [e for e in events if e["type"] == "tool_result" and e["callId"] == confirm["callId"]]
    assert results and results[0]["ok"] is True
    assert events[-1]["type"] == "done", types(events)
    assert float(world["backend"].task(task["id"])["points"]) == 2.5
    # 回复不得把已执行说成"待确认/未执行"
    assert "请在确认卡" not in text_of(events) and "未执行" not in text_of(events), text_of(events)


# 7. M6 及冒烟实测的肯定型变体：「把 X 挪到下个迭代」必须真的调工具出卡；未调工具就断言"不存在/已挪到"是幻觉。
#    低频（评审 1/4，本次实测 1/5 与 0/24），按评审建议跑 N 次统计失败率：>1/4 判失败，>0 给 warning 让人看到频率
HALLU_N = 4


def test_7_move_to_next_sprint_never_claims_without_tool(world):
    task = world["task"]
    assert task, "依赖用例 2"
    world["backend"].call("POST", f"/projects/{PROJECT_KEY}/sprints", json={"name": "冒烟迭代 2"})
    bad: list[str] = []
    for i in range(HALLU_N):
        agent = world["new_agent"]()
        events = agent.say(f"把 {task['displayKey']} 挪到下个迭代")
        cards = cards_of(events)
        if not tools_started(events) and not cards:
            bad.append(f"第 {i + 1} 次：未调工具就回复 → {text_of(events)!r}")
            continue
        assert cards and cards[-1]["card"]["tool"] == "move_task_to_sprint", (types(events), text_of(events))
        assert task["displayKey"] in cards[-1]["card"]["target"]
        reject_all(agent, events)
    assert world["backend"].task(task["id"])["sprintId"] is None
    if bad:
        warnings.warn(f"未调工具即断言 {len(bad)}/{HALLU_N}：" + " | ".join(bad), stacklevel=1)
    assert len(bad) <= 1, "\n".join(bad)


# 8. R2/X4a：「我在待办里有哪些任务」走 list_my_tasks(backlog)，不是全项目 list_backlog
def test_8_my_backlog_uses_list_my_tasks(world):
    other = world["backend"].call("POST", f"/projects/{PROJECT_KEY}/tasks",
                                  json={"type": "TASK", "title": "无人认领的待办任务"})   # 不指派
    world["other"] = other
    agent = world["new_agent"]()
    events = agent.say("我在待办里有哪些任务")
    started = tools_started(events)
    assert "list_my_tasks" in started and "list_backlog" not in started, (started, text_of(events))
    assert events[-1]["type"] == "done", types(events)
    assert other["displayKey"] not in text_of(events), "未指派给我的任务不该出现在「我的待办」里"


# 9. R4：先看 A 再看 B，「上一个」应指 A（或追问），不得盲目改 B
def test_9_previous_one_refers_to_second_last(world):
    a, b = world["task"], world.get("other")
    assert a and b, "依赖用例 2/8"
    agent = world["new_agent"]()
    ev1 = agent.say(f"看一下 {a['displayKey']}")
    assert "get_task" in tools_started(ev1) and ev1[-1]["type"] == "done"
    ev2 = agent.say(f"再看一下 {b['displayKey']}")
    assert "get_task" in tools_started(ev2) and ev2[-1]["type"] == "done"
    ev3 = agent.say("上一个改成进行中")
    cards = cards_of(ev3)
    if cards:   # 出卡：必须是 A
        assert len(cards) == 1 and cards[0]["card"]["tool"] == "update_task_status"
        assert a["displayKey"] in cards[0]["card"]["target"] and b["displayKey"] not in cards[0]["card"]["target"], cards
        reject_all(agent, ev3)
    else:       # 追问也合理：但不能什么都没做还说改好了
        assert ev3[-1]["type"] == "done" and "已" not in text_of(ev3)[:2], text_of(ev3)
    assert world["backend"].task(b["id"])["status"] == "TODO"


# 10. R1：多轮指代链里建任务不追问类型，且不得无端创建/删除子任务
def test_10_anaphora_chain_creates_no_stray_subtasks(world):
    title = "整理接口文档（冒烟）"
    agent = world["new_agent"]()
    ev1 = agent.say(f"建个任务：{title}")
    assert "create_task" in tools_started(ev1), f"没说类型也应默认 TASK 直接创建：{types(ev1)}\n{text_of(ev1)}"
    assert ev1[-1]["type"] == "done"
    created = world["backend"].find_task(title)
    assert created and created["type"] == "TASK"
    ev2 = agent.say("把它改成进行中")
    c2 = confirm_of(ev2)
    assert c2["card"]["tool"] == "update_task_status" and created["displayKey"] in c2["card"]["target"]
    reject_all(agent, ev2)
    ev3 = agent.say("它算 2 天")
    c3 = confirm_of(ev3)
    assert c3["card"]["tool"] == "update_task" and c3["card"]["args"]["points"] == 2.0
    assert created["displayKey"] in c3["card"]["target"]
    reject_all(agent, ev3)
    all_started = tools_started(ev1) + tools_started(ev2) + tools_started(ev3)
    assert not {"create_subtask", "delete_subtask"} & set(all_started), all_started
    assert world["backend"].call("GET", f"/tasks/{created['id']}/subtasks") == []
    assert world["backend"].task(created["id"])["status"] == "TODO"


# 11. Q8/R4：任务详情不念内部数字 id（负责人/长期计划/迭代用名称）
def test_11_task_details_do_not_leak_internal_ids(world):
    task = world["task"]
    assert task, "依赖用例 2"
    agent = world["new_agent"]()
    events = agent.say(f"看看 {task['displayKey']} 的详情")
    assert "get_task" in tools_started(events) and events[-1]["type"] == "done", types(events)
    reply = text_of(events)
    assert not INTERNAL_ID_RE.search(reply), reply
    assert "冒烟用户" in reply, reply   # 负责人以显示名出现
