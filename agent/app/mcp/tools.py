"""MCP 工具目录（mcp_profile）：从 tool_guard.REGISTRY 挑选精选子集 + 三个 MCP 专用工具 + 旧 Java 名别名。

规则（评审 §六 架构决策）：
- 入参只用展示号 / 名称 / 枚举（沿用 StrictModel，extra=forbid → schema 全部 additionalProperties:false）；
- 读工具 readOnlyHint；L1 创建 / L2 修改 idempotentHint；L3（close_sprint / start_sprint）destructiveHint + confirm:true 必填；
- 输出统一经 _wire 清洗（名称替代内部 id）；外部 agent 没有确认卡，create_tasks 用 dry_run 预览代替；
- 旧名兼容：list_sprints / list_epics / list_my_tasks 单独注册；create_tasks 的 projectKey/target、update_task_status 的 taskSeq
  以参数别名接受（同一工具，schema 只展示新名）。
"""
import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from mcp_types import ToolAnnotations
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

from app.harness import tool_guard as tg
from app.harness.auth import current_ctx
from app.mcp._exec import CONFIRM_REQUIRED_MSG, McpFail
from app.tools import catalog
from app.tools._client import PmApiError, client
from app.tools._params import SHANGHAI, SprintRefField, StrictModel, TaskKeyField, validate_date, validate_points
from app.tools._resolve import (Ambiguous, NotFound, resolve_epic, resolve_member, resolve_project_key,
                                resolve_sprint, task_project_key)
from app.tools._wire import NameIndex, load_name_index, strip_internal, task_to_wire
from app.tools.sprints import CloseSprintParams, ListSprintsParams, SprintNameParams
from app.tools.tasks import Status, UpdateTaskParams

DESC_MAX = 200          # list_my_work 描述摘要长度
BATCH_MAX = 20          # create_tasks 单次上限

# ---------- annotations ----------

READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
CREATE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)
UPDATE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=False)

# ---------- 输出 schema 片段（宽松：只描述形状，不强制 required，避免客户端校验误伤） ----------

STR: dict = {"type": "string"}
NSTR: dict = {"type": ["string", "null"]}
NNUM: dict = {"type": ["number", "null"]}
INT: dict = {"type": "integer"}
BOOL: dict = {"type": "boolean"}


def obj(desc: str, /, **props: dict) -> dict:
    return {"type": "object", "description": desc, "properties": props}


def arr(item: dict) -> dict:
    return {"type": "array", "items": item}


def nullable(schema: dict) -> dict:
    """客户端会按 outputSchema 校验 structuredContent：可能为 null 的对象必须显式 ["object", "null"]。"""
    return {**schema, "type": [schema["type"], "null"]}


ERROR_NOTE = "失败时 isError=true，内容为 {code, message}（AMBIGUOUS 时另带 candidates）"
PROJECT_OBJ = obj("项目", key=STR, name=STR, defaultSprintLength=STR, autoRotate=BOOL)
SPRINT_OBJ = obj("迭代", name=STR, status={"type": "string", "enum": ["PLANNED", "ACTIVE", "CLOSED"]},
                 startDate=NSTR, endDate=NSTR, length=NSTR)
EPIC_OBJ = obj("长期计划", name=STR, quarter=NSTR, status=NSTR, description=NSTR)
MEMBER_OBJ = obj("成员", displayName=NSTR, email=STR, role=STR)
TASK_OBJ = obj("任务（负责人/迭代/长期计划均为名称）", displayKey=STR, title=STR, type=STR, status=STR, points=NNUM,
               description=NSTR, assigneeName=NSTR, sprintName=NSTR, epicName=NSTR, createdAt=NSTR, updatedAt=NSTR,
               doneAt=NSTR)
WORK_ROW = obj("我的任务行", displayKey=STR, projectKey=STR, title=STR, type=STR, status=STR, points=NNUM,
               assigneeName=NSTR, sprintName=NSTR, epicName=NSTR, doneAt=NSTR, updatedAt=NSTR,
               description={**NSTR, "description": f"描述摘要（≤{DESC_MAX} 字）"}, subtaskDone=INT, subtaskTotal=INT)
SUBTASK_OBJ = obj("子任务", title=STR, done=BOOL, createdAt=NSTR)
COMMENT_OBJ = obj("评论", body=STR, authorName=NSTR, createdAt=NSTR)
TASK_RESULT = {**obj("修改后的任务", task=TASK_OBJ), "required": ["task"]}
FAILED_OBJ = obj("失败项", index=INT, title=STR, code=STR, message=STR)

# ---------- 参数 ----------

PK = Field(default=None, validation_alias=AliasChoices("project_key", "projectKey"),
           description="项目 key，如 XX；租户只有一个项目时可省略")
ALIAS_PK = Field(default=None, validation_alias=AliasChoices("projectKey", "project_key"), description="项目 key，如 XX")


class ProjectKeyParams(StrictModel):
    project_key: str | None = PK


class AliasProjectKeyParams(StrictModel):
    projectKey: str | None = ALIAS_PK


class McpBoardParams(StrictModel):
    project_key: str | None = PK
    sprint: str = SprintRefField


class TaskKeyParams(StrictModel):
    task_key: str = TaskKeyField


class ListMyWorkParams(StrictModel):
    scope: Literal["current", "next", "previous", "backlog", "all"] = Field(
        default="current",
        description="current=当前迭代，next=下一迭代，previous=最近关闭的迭代，backlog=待办，"
                    "all=当前+下一+全部已关闭迭代+待办")
    project_key: str | None = Field(default=None, validation_alias=AliasChoices("project_key", "projectKey"),
                                    description="项目 key；缺省跨全部项目")
    done_since: str | None = Field(default=None, description="只要 doneAt ≥ 该日（yyyy-MM-dd，Asia/Shanghai）的任务")
    updated_since: str | None = Field(default=None, description="只要 updatedAt ≥ 该日（yyyy-MM-dd）的任务")

    _d1 = field_validator("done_since")(classmethod(lambda cls, v: validate_date(v)))
    _d2 = field_validator("updated_since")(classmethod(lambda cls, v: validate_date(v)))


class AliasListMyTasksParams(StrictModel):
    projectKey: str | None = ALIAS_PK
    sprint: Literal["current", "previous"] = Field(default="current", description="current=当前迭代，previous=最近关闭的迭代")


class TaskItem(StrictModel):
    type: Literal["STORY", "BUG", "TASK"] = Field(default="TASK", description="类型，缺省 TASK")
    title: str = Field(min_length=1, description="标题（动宾短语）")
    description: str | None = None
    points: float | None = Field(default=None, description="天数 0.5-5，步进 0.5；不确定就留空")
    epic_name: str | None = Field(default=None, validation_alias=AliasChoices("epic_name", "epic"),
                                  description="所属长期计划名称")
    assignee: str | None = Field(default=None, description="负责人姓名/邮箱/me；缺省指派给自己")
    unassigned: bool = Field(default=False, description="true=明确不指派")

    _p = field_validator("points")(classmethod(lambda cls, v: validate_points(v)))

    @model_validator(mode="after")
    def _assignee_consistent(self):
        if self.assignee and self.unassigned:
            raise ValueError("assignee 与 unassigned 不能同时给")
        return self


class CreateTasksParams(StrictModel):
    project_key: str | None = PK
    sprint: str = Field(default="backlog", validation_alias=AliasChoices("sprint", "target"),
                        description="current/next/backlog 或迭代名称（旧值 current_sprint/next_sprint 亦可）")
    tasks: list[TaskItem] = Field(min_length=1, max_length=BATCH_MAX, description=f"≤{BATCH_MAX} 条，更多请分批")
    dry_run: bool = Field(default=False, description="true=只解析并返回预览，不创建。先 dry_run 把清单给用户确认再正式创建")


class McpUpdateStatusParams(StrictModel):
    task_key: str = Field(validation_alias=AliasChoices("task_key", "taskSeq"), description="任务展示号，如 XX-0")
    status: Status = Field(description="目标状态：完成→COMPLETED，归档/验收通过→DONE，开始做→IN_PROGRESS")

    _up = field_validator("status", mode="before")(classmethod(lambda cls, v: v.upper() if isinstance(v, str) else v))


class McpUpdateTaskParams(UpdateTaskParams):
    task_key: str = Field(validation_alias=AliasChoices("task_key", "taskSeq"), description="任务展示号，如 XX-0")


class McpMoveTaskParams(StrictModel):
    task_key: str = TaskKeyField
    sprint: str = Field(description="目标：current/next/backlog 或迭代名称")


CONFIRM_DESC = "必须为 true。调用前先把要操作的迭代名称、影响（任务去向/不可逆）展示给用户并取得明确同意；未同意不得调用"


class McpCloseSprintParams(CloseSprintParams):
    project_key: str | None = PK
    confirm: bool = Field(description=CONFIRM_DESC)


class McpStartSprintParams(StrictModel):
    project_key: str | None = PK
    sprint: str = Field(description="要开始的迭代名称，或 next")
    confirm: bool = Field(description=CONFIRM_DESC)


# ---------- 公共 ----------

def _reg(name: str) -> tg.ToolSpec:
    catalog.load_all()
    return tg.REGISTRY[name]


async def _call_reg(name: str, p: BaseModel, **override: Any) -> Any:
    """按内部工具的 params 重建入参再调用（MCP 形参可与内部形参名不同）。"""
    spec = _reg(name)
    data = {**p.model_dump(exclude_unset=True), **override}
    return await spec.fn(spec.params.model_validate({k: v for k, v in data.items() if k in spec.params.model_fields}))


async def _task_result(view: dict) -> dict:
    idx = await load_name_index(task_project_key(view))
    return {"task": task_to_wire(view, idx)}


def _pick_sprint(sprints: list[dict], scope: str) -> dict | None:
    if scope == "current":
        return next((s for s in sprints if s.get("status") == "ACTIVE"), None)
    if scope == "next":
        planned = sorted((s for s in sprints if s.get("status") == "PLANNED"),
                         key=lambda s: (s.get("startDate") or "", s.get("id") or 0))
        return planned[0] if planned else None
    if scope == "previous":
        closed = sorted((s for s in sprints if s.get("status") == "CLOSED"),
                        key=lambda s: (s.get("endDate") or "", s.get("id") or 0), reverse=True)
        return closed[0] if closed else None
    return None


def _sprint_summary(s: dict | None) -> dict | None:
    return strip_internal({k: v for k, v in s.items() if k != "tasks"}) if s else None


def _member_label(m: dict | None) -> str | None:
    return (m.get("displayName") or m.get("email")) if m else None


# ---------- 读：新工具 ----------

async def get_project_overview(p: ProjectKeyParams) -> dict:
    key = await resolve_project_key(p.project_key)
    c = client()
    projects, sprints, epics, dash = await asyncio.gather(
        c.get("/projects"), c.get(f"/projects/{key}/sprints"), c.get(f"/projects/{key}/epics"),
        c.get(f"/projects/{key}/dashboard"))
    sprints, epics, dash = sprints or [], epics or [], dash or {}
    name = next((pr.get("name") for pr in projects or [] if pr.get("key") == key), None)
    return {"projectKey": key, "projectName": name,
            "currentSprint": _sprint_summary(_pick_sprint(sprints, "current")),
            "nextSprint": _sprint_summary(_pick_sprint(sprints, "next")),
            "lastClosedSprint": _sprint_summary(_pick_sprint(sprints, "previous")),
            "counts": dash.get("counts"), "donePct": dash.get("donePct"),
            "epics": strip_internal(epics)}


def _day_start(day: str | None) -> datetime | None:
    return datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=SHANGHAI) if day else None


def _at_or_after(ts: str | None, since: datetime | None) -> bool:
    if since is None:
        return True
    if not ts:
        return False
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")) >= since


def _work_row(view: dict, subtasks: list[dict], idx: NameIndex, key: str) -> dict:
    desc = view.get("description")
    return {"displayKey": view.get("displayKey") or f"{key}-{view.get('seq')}", "projectKey": key,
            "title": view.get("title"), "type": view.get("type"), "status": view.get("status"),
            "points": view.get("points"), "assigneeName": idx.member_name(view.get("assigneeId")),
            "sprintName": idx.sprint_name(view.get("sprintId")), "epicName": idx.epic_name(view.get("epicId")),
            "doneAt": view.get("doneAt"), "updatedAt": view.get("updatedAt"),
            "description": desc[:DESC_MAX] if isinstance(desc, str) else None,
            "subtaskDone": sum(1 for s in subtasks if s.get("done")), "subtaskTotal": len(subtasks)}


async def _my_work_in_project(key: str, scopes: set[str], me: int, members: list[dict]) -> list[dict]:
    """先按迭代看板/待办列表挑出指派给我的任务 id，再并发取详情与子任务（全是 GET）。"""
    c = client()
    sprints, epics = await asyncio.gather(c.get(f"/projects/{key}/sprints"), c.get(f"/projects/{key}/epics"))
    sprints, epics = sprints or [], epics or []
    idx = NameIndex(members=members, epics=epics, sprints=sprints)
    ids: list[int] = []
    seen: set[int] = set()

    def _take(t: dict) -> None:
        if t.get("assigneeId") == me and t.get("id") is not None and t["id"] not in seen:
            seen.add(t["id"])
            ids.append(t["id"])

    picked: list[dict] = []
    for scope in ("current", "next", "previous"):
        if scope not in scopes:
            continue
        s = _pick_sprint(sprints, scope)
        if s is not None:
            picked.append(s)
    if "closed" in scopes:
        # 全部已关闭迭代（新→旧），previous 已选中的不重复拉
        chosen = {s["id"] for s in picked}
        picked.extend(s for s in sorted((x for x in sprints if x.get("status") == "CLOSED"),
                                        key=lambda x: (x.get("endDate") or "", x.get("id") or 0), reverse=True)
                      if s["id"] not in chosen)
    boards = await asyncio.gather(*(c.get(f"/sprints/{s['id']}/board") for s in picked))
    for board in boards:
        for items in ((board or {}).get("columns") or {}).values():
            for t in items or []:
                _take(t)
    if "backlog" in scopes:
        for t in await c.get(f"/projects/{key}/backlog") or []:
            _take(t)
    if not ids:
        return []
    details = await asyncio.gather(*(c.get(f"/tasks/{i}") for i in ids))
    subtasks = await asyncio.gather(*(c.get(f"/tasks/{i}/subtasks") for i in ids))
    return [_work_row(v or {}, subs or [], idx, key) for v, subs in zip(details, subtasks, strict=True)]


async def list_my_work(p: ListMyWorkParams) -> dict:
    c = client()
    if p.project_key:
        keys = [await resolve_project_key(p.project_key)]
    else:
        keys = [str(pr.get("key")) for pr in await c.get("/projects") or []]
    # all = 当前 + 下一 + 全部已关闭（不只最近一个）+ 待办；否则 done_since 补周报永远拿不到更早迭代的任务
    scopes = {"current", "next", "previous", "closed", "backlog"} if p.scope == "all" else {p.scope}
    members = await c.get("/members") or []
    me = current_ctx().user_id
    rows: list[dict] = []
    for key in keys:
        rows.extend(await _my_work_in_project(key, scopes, me, members))
    done_since, updated_since = _day_start(p.done_since), _day_start(p.updated_since)
    rows = [r for r in rows if _at_or_after(r["doneAt"], done_since) and _at_or_after(r["updatedAt"], updated_since)]
    return {"scope": p.scope, "projects": keys, "count": len(rows), "tasks": rows}


async def search_tasks(p: BaseModel) -> dict:
    hits = await _call_reg("search_tasks", p)
    idx = NameIndex(members=await client().get("/members") or [])
    return {"hits": [{**{k: v for k, v in h.items() if k != "assigneeId"},
                      "assigneeName": idx.member_name(h.get("assigneeId"))} for h in hits.get("hits") or []]}


async def list_members(p: BaseModel) -> dict:
    members = await client().get("/members") or []
    return {"members": [{"displayName": m.get("displayName"), "email": m.get("email"), "role": m.get("role")}
                        for m in members]}


# ---------- 写：create_tasks（批量，dry_run） ----------

_SPRINT_ALIAS = {"current_sprint": "current", "next_sprint": "next"}


async def create_tasks(p: CreateTasksParams) -> dict:
    key = await resolve_project_key(p.project_key)
    sprint = await resolve_sprint(_SPRINT_ALIAS.get(p.sprint.strip().lower(), p.sprint), key)
    c = client()
    members = await c.get("/members") or []
    me = current_ctx().user_id
    my_name = _member_label(next((m for m in members if m.get("userId") == me), None))
    preview: list[dict] = []
    bodies: list[tuple[int, dict]] = []
    failed: list[dict] = []
    for i, item in enumerate(p.tasks):
        try:
            body: dict = {"type": item.type, "title": item.title}
            if item.description:
                body["description"] = item.description
            if item.points is not None:
                body["points"] = item.points
            assignee_name: str | None = None
            if item.assignee:
                m = await resolve_member(item.assignee)
                body["assigneeId"], assignee_name = m["userId"], _member_label(m)
            elif not item.unassigned:
                body["assigneeId"], assignee_name = me, my_name
            epic_name: str | None = None
            if item.epic_name:
                e = await resolve_epic(item.epic_name, key)
                body["epicId"], epic_name = e["id"], e.get("name")
            if sprint.get("id") is not None:
                body["sprintId"] = sprint["id"]
        except NotFound as exc:
            failed.append({"index": i, "title": item.title, "code": "NOT_FOUND", "message": exc.message})
            continue
        except Ambiguous as exc:
            failed.append({"index": i, "title": item.title, "code": "AMBIGUOUS", "message": exc.message,
                           "candidates": exc.candidates})
            continue
        preview.append({"index": i, "title": item.title, "type": item.type, "points": item.points,
                        "assigneeName": assignee_name, "epicName": epic_name, "description": item.description})
        bodies.append((i, body))
    out = {"dryRun": p.dry_run, "projectKey": key, "sprintName": sprint.get("name"), "preview": preview,
           "created": [], "failed": failed}
    if p.dry_run:
        return out
    created: list[dict] = []
    halted = False
    for i, body in bodies:
        if halted:   # 后端不可达 / 令牌失效后不再逐条硬试
            failed.append({"index": i, "title": body["title"], "code": "SKIPPED", "message": "前一条失败后未执行"})
            continue
        try:
            view = await c.post(f"/projects/{key}/tasks", json=body) or {}
        except PmApiError as exc:
            failed.append({"index": i, "title": body["title"], "code": exc.code, "message": exc.message})
            halted = exc.status in (0, 401)
            continue
        created.append({"index": i, "displayKey": view.get("displayKey"), "title": view.get("title"),
                        "type": view.get("type"), "status": view.get("status")})
    out["created"] = created
    out["failed"] = sorted(failed, key=lambda f: f["index"])
    return out


# ---------- 写：包装内部工具 ----------

async def update_task_status(p: McpUpdateStatusParams) -> dict:
    return await _task_result(await _call_reg("update_task_status", p))


async def update_task(p: McpUpdateTaskParams) -> dict:
    return await _task_result(await _call_reg("update_task", p))


async def move_task_to_sprint(p: McpMoveTaskParams) -> dict:
    return await _task_result(await _call_reg("move_task_to_sprint", p))


async def add_comment(p: BaseModel) -> dict:
    comment = await _call_reg("add_comment", p) or {}
    members = await client().get("/members") or []
    me = current_ctx().user_id
    return {"comment": {**strip_internal(comment),
                        "authorName": _member_label(next((m for m in members if m.get("userId") == me), None))}}


async def create_subtask(p: BaseModel) -> dict:
    return {"subtask": strip_internal(await _call_reg("create_subtask", p) or {})}


def _require_confirm(p: Any) -> None:
    if not getattr(p, "confirm", False):
        raise McpFail("CONFIRM_REQUIRED", CONFIRM_REQUIRED_MSG)


async def close_sprint(p: McpCloseSprintParams) -> dict:
    _require_confirm(p)
    inner = CloseSprintParams.model_validate(p.model_dump(exclude={"confirm"}, exclude_unset=True))
    return {"sprint": strip_internal(await _reg("close_sprint").fn(inner) or {})}


async def start_sprint(p: McpStartSprintParams) -> dict:
    _require_confirm(p)
    inner = SprintNameParams(project_key=p.project_key, sprint_name=p.sprint)
    return {"sprint": strip_internal(await _reg("start_sprint").fn(inner) or {})}


# ---------- 旧名别名（thin wrapper） ----------

async def alias_list_sprints(p: AliasProjectKeyParams) -> dict:
    data = await _reg("list_sprints").fn(ListSprintsParams(project_key=p.projectKey))
    return {"projectKey": data["projectKey"], "sprints": [_sprint_summary(s) for s in data.get("sprints") or []]}


async def alias_list_epics(p: AliasProjectKeyParams) -> dict:
    data = await _call_reg("list_epics", p, project_key=p.projectKey)
    return {"projectKey": data["projectKey"], "epics": strip_internal(data.get("epics") or [])}


async def alias_list_my_tasks(p: AliasListMyTasksParams) -> dict:
    data = await list_my_work(ListMyWorkParams(scope=p.sprint, project_key=p.projectKey))
    return {"projectKey": data["projects"][0] if data["projects"] else None, "sprint": p.sprint,
            "tasks": [{"seq": r["displayKey"], **r} for r in data["tasks"]]}


# ---------- 目录 ----------

@dataclass(frozen=True)
class McpToolDef:
    name: str
    title: str
    description: str
    params: type[BaseModel]
    call: Callable[[BaseModel], Awaitable[dict]]
    annotations: ToolAnnotations
    output_schema: dict


def _reg_call(name: str) -> Callable[[BaseModel], Awaitable[dict]]:
    async def call(p: BaseModel) -> dict:
        return await _reg(name).fn(p)
    return call


def _reg_params(name: str) -> type[BaseModel]:
    return _reg(name).params


def mcp_profile() -> list[McpToolDef]:
    """精选工具（读 7 / L1 3 / L2 3 / L3 2）+ 旧名别名 3；顺序即 tools/list 顺序。"""
    return [
        # ---- 读 ----
        McpToolDef("list_projects", "项目列表", "列出当前租户的所有项目（key 与名称）。其它工具的 project_key 从这里取。",
                   _reg_params("list_projects"), _reg_call("list_projects"), READ,
                   obj("项目列表", projects=arr(PROJECT_OBJ))),
        McpToolDef("get_project_overview", "项目概览",
                   "一次拿到项目的当前/下一/最近关闭迭代、当前迭代四态任务计数与完成百分比、长期计划列表。",
                   ProjectKeyParams, get_project_overview, READ,
                   obj("项目概览", projectKey=STR, projectName=NSTR, currentSprint=nullable(SPRINT_OBJ),
                       nextSprint=nullable(SPRINT_OBJ), lastClosedSprint=nullable(SPRINT_OBJ),
                       counts=nullable(obj("四态计数")), donePct=NNUM, epics=arr(EPIC_OBJ))),
        McpToolDef("list_my_work", "我的任务",
                   "列出指派给我的任务（缺省跨全部项目）：当前/下一/最近关闭的迭代、待办，或 all=以上加全部已关闭迭代；"
                   "含 doneAt/updatedAt/描述摘要/子任务进度，可按 done_since/updated_since 过滤。写日报、周报、standup 用这个。",
                   ListMyWorkParams, list_my_work, READ,
                   obj("我的任务", scope=STR, projects=arr(STR), count=INT, tasks=arr(WORK_ROW))),
        McpToolDef("get_task", "任务详情", "任务详情（负责人/长期计划/迭代均为名称），含子任务与评论。",
                   TaskKeyParams, _reg_call("get_task"), READ,
                   obj("任务详情", task=TASK_OBJ, subtasks=arr(SUBTASK_OBJ), comments=arr(COMMENT_OBJ))),
        McpToolDef("search_tasks", "搜索任务", "按关键词搜索全租户任务（标题/描述），最多 20 条，返回展示号与标题。",
                   _reg_params("search_tasks"), search_tasks, READ,
                   obj("搜索结果", hits=arr(obj("命中", displayKey=STR, projectKey=STR, title=STR, type=STR, status=STR,
                                                points=NNUM, assigneeName=NSTR)))),
        McpToolDef("get_board", "迭代看板", "某个迭代内的任务按 TODO/IN_PROGRESS/COMPLETED/DONE 四列展示（所有人的）。",
                   McpBoardParams, lambda p: _call_reg("get_board", p), READ,
                   obj("看板", projectKey=STR, sprint=nullable(SPRINT_OBJ), daysLeft=NNUM, columns=obj("状态→任务列表"))),
        McpToolDef("list_members", "成员列表", "列出租户成员（姓名、邮箱、角色），指派负责人前查这里。",
                   _reg_params("list_members"), list_members, READ, obj("成员", members=arr(MEMBER_OBJ))),
        # ---- L1 ----
        McpToolDef("create_tasks", "批量创建任务",
                   f"批量创建任务（≤{BATCH_MAX} 条），可挂迭代、长期计划、负责人（缺省自己）。先 dry_run=true 拿到预览"
                   "向用户展示清单并确认，再正式创建；逐条返回 created/failed。",
                   CreateTasksParams, create_tasks, CREATE,
                   {**obj("创建结果", dryRun=BOOL, projectKey=STR, sprintName=STR,
                          preview=arr(obj("预览项", index=INT, title=STR, type=STR, points=NNUM, assigneeName=NSTR,
                                          epicName=NSTR, description=NSTR)),
                          created=arr(obj("已创建", index=INT, displayKey=NSTR, title=NSTR, type=NSTR, status=NSTR)),
                          failed=arr(FAILED_OBJ)),
                    "required": ["dryRun", "created", "failed"]}),
        McpToolDef("add_comment", "添加评论", "给任务添加一条评论。", _reg_params("add_comment"), add_comment, CREATE,
                   obj("评论", comment=COMMENT_OBJ)),
        McpToolDef("create_subtask", "添加子任务", "给任务添加一个子任务。", _reg_params("create_subtask"),
                   create_subtask, CREATE, obj("子任务", subtask=SUBTASK_OBJ)),
        # ---- L2 ----
        McpToolDef("update_task_status", "修改任务状态",
                   "修改任务状态：完成→COMPLETED，归档/验收通过→DONE，开始做→IN_PROGRESS；含糊时先问用户。",
                   McpUpdateStatusParams, update_task_status, UPDATE, TASK_RESULT),
        McpToolDef("update_task", "修改任务", "修改任务的标题/描述/天数/负责人/长期计划；clear_* 表示清空。",
                   McpUpdateTaskParams, update_task, UPDATE, TASK_RESULT),
        McpToolDef("move_task_to_sprint", "移动任务", "把任务移入某个迭代，或移回待办（sprint=backlog）。",
                   McpMoveTaskParams, move_task_to_sprint, UPDATE, TASK_RESULT),
        # ---- L3 ----
        McpToolDef("close_sprint", "关闭迭代",
                   "关闭迭代（不可逆）：未完成任务移回待办或移到目标迭代。调用前必须先向用户展示迭代名称与未完成任务去向，"
                   "取得同意后带 confirm=true。",
                   McpCloseSprintParams, close_sprint, DESTRUCTIVE, obj("已关闭的迭代", sprint=SPRINT_OBJ)),
        McpToolDef("start_sprint", "开始迭代",
                   "把已计划的迭代设为进行中（同一项目同时只能有一个）。调用前必须先向用户展示要开始的迭代与日期，"
                   "取得同意后带 confirm=true。",
                   McpStartSprintParams, start_sprint, DESTRUCTIVE, obj("已开始的迭代", sprint=SPRINT_OBJ)),
        # ---- 旧名别名 ----
        McpToolDef("list_sprints", "迭代列表（旧名）", "列出项目的迭代与状态、起止日期。建议改用 get_project_overview。",
                   AliasProjectKeyParams, alias_list_sprints, READ, obj("迭代", projectKey=STR, sprints=arr(SPRINT_OBJ))),
        McpToolDef("list_epics", "长期计划列表（旧名）", "列出项目的长期计划。建议改用 get_project_overview。",
                   AliasProjectKeyParams, alias_list_epics, READ, obj("长期计划", projectKey=STR, epics=arr(EPIC_OBJ))),
        McpToolDef("list_my_tasks", "我的迭代任务（旧名）", "我在当前/最近关闭迭代的任务。建议改用 list_my_work。",
                   AliasListMyTasksParams, alias_list_my_tasks, READ,
                   obj("我的任务", projectKey=NSTR, sprint=STR, tasks=arr({**WORK_ROW, "properties": {"seq": STR, **WORK_ROW["properties"]}}))),
    ]


def input_schema(params: type[BaseModel]) -> dict:
    """入参 JSON schema：去 pydantic title、保证 object + additionalProperties:false（StrictModel 已给）。"""
    schema = tg._strip_titles(params.model_json_schema())
    schema.setdefault("type", "object")
    schema.setdefault("properties", {})
    schema.setdefault("additionalProperties", False)
    return schema
