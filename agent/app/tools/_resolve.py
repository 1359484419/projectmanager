"""展示号 / 名称 → 内部 id 的解析：唯一允许间接接触内部 id 的地方。

解析失败给出可操作的中文提示（NotFound），多义名称返回候选（Ambiguous）让模型追问，不自动挑第一个。
"""
import re
from collections.abc import Callable
from app.harness.auth import current_ctx
from app.tools._client import PmApiError, client

TASK_KEY_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9]*)-(\d+)\s*$")
SELF_ALIASES: frozenset[str] = frozenset({"me", "我", "自己", "本人", "我自己", "myself"})
SPRINT_CURRENT: frozenset[str] = frozenset({"current", "active", "当前", "当前迭代", "本迭代", "进行中"})
SPRINT_NEXT: frozenset[str] = frozenset({"next", "下一个", "下个", "下一迭代", "下个迭代"})
SPRINT_BACKLOG: frozenset[str] = frozenset({"backlog", "待办", "none", "无"})


class NotFound(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class Ambiguous(Exception):
    def __init__(self, message: str, candidates: list[str]):
        super().__init__(message)
        self.message = message
        self.candidates = candidates


def _pick(kind: str, query: str, items: list[dict], exact: Callable[[dict], bool],
          partial: Callable[[dict], bool], label: Callable[[dict], str]) -> dict:
    """先完全匹配，再包含匹配；唯一 → 返回，多个 → Ambiguous，没有 → NotFound。"""
    hits = [i for i in items if exact(i)]
    if not hits:
        hits = [i for i in items if partial(i)]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        # 候选名是用户数据：只放 candidates（act 会包进 <data>），不拼进文案（spec §7.3）
        names = [label(i) for i in hits]
        raise Ambiguous(f"{kind}「{query}」匹配多个，请从候选中指明", names)
    raise NotFound(f"{kind}「{query}」不存在")


# ---------- 项目 ----------

async def resolve_project_key(key: str | None) -> str:
    """显式 key → 校验存在；None → 面板当前项目；仍无 → 只有一个项目时取它，多个 → Ambiguous 让模型追问（不自动挑第一个）。"""
    if key:
        projects = await client().get("/projects")
        for p in projects:
            if str(p.get("key", "")).lower() == key.strip().lower():
                return p["key"]
        raise NotFound(f"项目 {key} 不存在，可用 list_projects 查看")
    ctx = current_ctx()
    if ctx.project_key:
        return ctx.project_key
    projects = await client().get("/projects")
    if not projects:
        raise NotFound("当前租户还没有项目，请先在网页里创建项目")
    if len(projects) > 1:
        keys = [str(p.get("key")) for p in projects]
        raise Ambiguous("当前未选择项目，请从候选中指明 project_key", keys)
    return projects[0]["key"]


# ---------- 任务 ----------

def parse_task_key(task_key: str) -> tuple[str, int]:
    m = TASK_KEY_RE.match(task_key or "")
    if not m:
        raise NotFound(f"任务展示号格式应为 XX-0，收到「{task_key}」；可用 search_tasks 按标题查找")
    return m.group(1).upper(), int(m.group(2))


async def resolve_task(task_key: str) -> dict:
    """"PM-12" → 完整 TaskView。先搜索（只认 displayKey 完全相等），再扫项目内迭代/待办/记录列表按 seq 找。"""
    project_key, seq = parse_task_key(task_key)
    display_key = f"{project_key}-{seq}"
    c = client()

    hits = await c.get("/tasks/search", params={"q": display_key}) or []
    for h in hits:
        if h.get("displayKey") == display_key:
            return await c.get(f"/tasks/{h['id']}")

    # 搜索只匹配标题/描述，展示号不在标题里时搜不到 → 按 seq 扫项目内列表
    try:
        sprints = await c.get(f"/projects/{project_key}/sprints", params={"withTasks": "true"}) or []
    except PmApiError as exc:
        if exc.status == 404:
            raise NotFound(f"项目 {project_key} 不存在，可用 list_projects 查看") from exc
        raise
    for s in sprints:
        for t in s.get("tasks") or []:
            if t.get("seq") == seq:
                return await c.get(f"/tasks/{t['id']}")
    for path in (f"/projects/{project_key}/backlog", f"/projects/{project_key}/records"):
        for t in await c.get(path) or []:
            if t.get("seq") == seq:
                return await c.get(f"/tasks/{t['id']}")
    raise NotFound(f"任务 {display_key} 不存在，可用 search_tasks 查找")


def task_project_key(task: dict) -> str:
    return str(task["displayKey"]).rsplit("-", 1)[0]


def brief_with_key(project_key: str, brief: dict, status: str | None = None) -> dict:
    """Java TaskBrief（看板列/概览分组）只有 seq 没有 displayKey：补上展示号、去掉内部 id（模型只按 XX-0 指代）。"""
    out = {k: v for k, v in brief.items() if k != "id"}
    if brief.get("seq") is not None:
        out["displayKey"] = f"{project_key}-{brief['seq']}"
    if status and not out.get("status"):
        out["status"] = status
    return out


def groups_with_keys(project_key: str, groups: dict | None) -> dict | None:
    """{状态: [TaskBrief]} → 每条任务带 displayKey。"""
    if not isinstance(groups, dict):
        return groups
    return {status: [brief_with_key(project_key, t, status) for t in (items or [])] for status, items in groups.items()}


# ---------- 迭代 ----------

async def resolve_sprint(ref: str, project_key: str) -> dict:
    """current/next/backlog/名称 → SprintView；backlog 返回 {"id": None, "name": "待办"}。"""
    q = (ref or "current").strip()
    low = q.lower()
    if low in SPRINT_BACKLOG:
        return {"id": None, "name": "待办", "status": None}
    sprints = await client().get(f"/projects/{project_key}/sprints") or []
    if low in SPRINT_CURRENT:
        for s in sprints:
            if s.get("status") == "ACTIVE":
                return s
        raise NotFound("当前没有进行中的迭代，可用 list_sprints 查看或 start_sprint 开始一个")
    if low in SPRINT_NEXT:
        planned = sorted((s for s in sprints if s.get("status") == "PLANNED"),
                         key=lambda s: (s.get("startDate") or "", s.get("id") or 0))
        if planned:
            return planned[0]
        raise NotFound("没有下一个迭代，可先 create_sprint")
    return _pick("迭代", q, sprints,
                 exact=lambda s: str(s.get("name", "")).lower() == low,
                 partial=lambda s: low in str(s.get("name", "")).lower(),
                 label=lambda s: str(s.get("name", "")))


async def require_sprint_id(ref: str, project_key: str) -> dict:
    s = await resolve_sprint(ref, project_key)
    if s.get("id") is None:
        raise NotFound("该操作需要一个具体的迭代，「待办」不是迭代")
    return s


# ---------- 成员 ----------

async def resolve_member(name: str) -> dict:
    """姓名 / 邮箱 / 邮箱前缀（大小写不敏感）；me/我 → 当前用户。"""
    q = (name or "").strip()
    low = q.lower()
    members = await client().get("/members") or []
    if low in SELF_ALIASES:
        me = current_ctx().user_id
        for m in members:
            if m.get("userId") == me:
                return m
        raise NotFound("当前用户不在成员列表中")

    def _email_prefix(m: dict) -> str:
        return str(m.get("email") or "").split("@", 1)[0].lower()

    return _pick("成员", q, members,
                 exact=lambda m: str(m.get("displayName") or "").lower() == low
                 or str(m.get("email") or "").lower() == low or _email_prefix(m) == low,
                 partial=lambda m: low in str(m.get("displayName") or "").lower()
                 or _email_prefix(m).startswith(low),
                 label=lambda m: str(m.get("displayName") or m.get("email") or m.get("userId")))


# ---------- 长期计划 ----------

async def resolve_epic(name: str, project_key: str) -> dict:
    q = (name or "").strip()
    low = q.lower()
    epics = await client().get(f"/projects/{project_key}/epics") or []
    return _pick("长期计划", q, epics,
                 exact=lambda e: str(e.get("name", "")).lower() == low,
                 partial=lambda e: low in str(e.get("name", "")).lower(),
                 label=lambda e: str(e.get("name", "")))


# ---------- 子任务 ----------

async def resolve_subtask(task: dict, subtask_title: str) -> dict:
    q = (subtask_title or "").strip()
    low = q.lower()
    subs = await client().get(f"/tasks/{task['id']}/subtasks") or []
    return _pick("子任务", q, subs,
                 exact=lambda s: str(s.get("title", "")).lower() == low,
                 partial=lambda s: low in str(s.get("title", "")).lower(),
                 label=lambda s: str(s.get("title", "")))


def is_self(name: str | None) -> bool:
    return bool(name) and name.strip().lower() in SELF_ALIASES

