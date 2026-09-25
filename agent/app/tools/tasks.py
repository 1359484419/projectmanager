"""任务：查询、创建、修改状态/字段、移动迭代、删除。"""
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.harness.auth import RequestCtx, current_ctx
from app.harness.tool_guard import Risk, pm_tool
from app.tools._client import client
from app.tools._params import (ProjectKeyField, SprintRefField, StrictModel, TaskKeyField,
                               title_of, validate_points)
from app.tools._resolve import (brief_with_key, is_self, resolve_epic, resolve_member, resolve_project_key,
                                resolve_sprint, resolve_task, task_project_key)

Status = Literal["TODO", "IN_PROGRESS", "COMPLETED", "DONE"]
STATUS_LABEL = {"TODO": "待办", "IN_PROGRESS": "进行中", "COMPLETED": "已完成", "DONE": "已归档"}


# ---------- 参数 ----------

class ListBacklogParams(StrictModel):
    project_key: str | None = ProjectKeyField


class ListMyTasksParams(StrictModel):
    project_key: str | None = ProjectKeyField
    sprint: Literal["current", "next", "backlog"] = Field(default="current", description="查哪里：current=当前迭代，next=下一迭代，backlog=待办")


class TaskKeyParams(StrictModel):
    task_key: str = TaskKeyField


class SearchTasksParams(StrictModel):
    q: str = Field(min_length=1, description="关键词（匹配标题/描述），最多返回 20 条")


class CreateTaskParams(StrictModel):
    project_key: str | None = ProjectKeyField
    type: Literal["STORY", "BUG", "TASK"] = Field(description="任务类型")
    title: str = Field(min_length=1, description="标题")
    description: str | None = None
    points: float | None = Field(default=None, description="天数：0.5-5，步进 0.5")
    assignee: str | None = Field(default=None, description="负责人姓名/邮箱；缺省即指派给当前用户本人（用户说\"帮我建\"就是给自己）")
    unassigned: bool = Field(default=False, description="仅当用户明确说\"先不指派/不指定负责人\"时为 true，任务留空负责人")
    epic_name: str | None = Field(default=None, description="所属长期计划名称")
    sprint: str | None = Field(default=None, description="放入哪个迭代：current/next/名称；缺省或 backlog 进待办")

    _p = field_validator("points")(classmethod(lambda cls, v: validate_points(v)))

    @model_validator(mode="after")
    def _assignee_consistent(self):
        if self.assignee and self.unassigned:
            raise ValueError("assignee 与 unassigned 不能同时给")
        return self


class UpdateTaskStatusParams(StrictModel):
    task_key: str = TaskKeyField
    status: Status = Field(description="目标状态")


class UpdateTaskParams(StrictModel):
    task_key: str = TaskKeyField
    title: str | None = Field(default=None, description="新标题")
    description: str | None = Field(default=None, description="新描述")
    points: float | None = Field(default=None, description="天数：0.5-5，步进 0.5")
    assignee: str | None = Field(default=None, description="新负责人姓名/邮箱；me/我 表示自己")
    clear_assignee: bool = Field(default=False, description="true 表示取消指派")
    epic_name: str | None = Field(default=None, description="改挂到哪个长期计划")
    clear_epic: bool = Field(default=False, description="true 表示摘除长期计划")

    _p = field_validator("points")(classmethod(lambda cls, v: validate_points(v)))

    @model_validator(mode="after")
    def _consistent(self):
        if self.assignee and self.clear_assignee:
            raise ValueError("assignee 与 clear_assignee 不能同时给")
        if self.epic_name and self.clear_epic:
            raise ValueError("epic_name 与 clear_epic 不能同时给")
        if not any((self.title is not None, self.description is not None, self.points is not None,
                    self.assignee, self.clear_assignee, self.epic_name, self.clear_epic)):
            raise ValueError("至少提供一个要修改的字段")
        return self


class MoveTaskParams(StrictModel):
    task_key: str = TaskKeyField
    sprint: str = Field(description="目标：current/next/backlog 或迭代名称")


# ---------- L0 ----------

@pm_tool(name="list_backlog", risk="L0", params=ListBacklogParams, label="查询待办",
         description="列出项目待办（不属于任何迭代的任务）。")
async def list_backlog(p: ListBacklogParams) -> dict:
    key = await resolve_project_key(p.project_key)
    return {"projectKey": key, "tasks": await client().get(f"/projects/{key}/backlog")}


@pm_tool(name="list_my_tasks", risk="L0", params=ListMyTasksParams, label="查询我的任务",
         description="列出指派给我的任务：当前迭代 / 下一迭代 / 待办。")
async def list_my_tasks(p: ListMyTasksParams) -> dict:
    key = await resolve_project_key(p.project_key)
    me = current_ctx().user_id
    if p.sprint == "backlog":
        rows = await client().get(f"/projects/{key}/backlog") or []
        mine = [t for t in rows if t.get("assigneeId") == me]
    else:
        s = await resolve_sprint(p.sprint, key)
        board = await client().get(f"/sprints/{s['id']}/board") or {}
        mine = []
        for status, items in (board.get("columns") or {}).items():
            for t in items or []:
                if t.get("assigneeId") == me:
                    mine.append(brief_with_key(key, t, status))
    return {"projectKey": key, "sprint": p.sprint, "tasks": mine}


@pm_tool(name="get_task", risk="L0", params=TaskKeyParams, label="查询任务详情",
         description="任务详情（含子任务与评论）。")
async def get_task(p: TaskKeyParams) -> dict:
    t = await resolve_task(p.task_key)
    c = client()
    subtasks = await c.get(f"/tasks/{t['id']}/subtasks") or []
    comments = await c.get(f"/tasks/{t['id']}/comments") or []
    return {"task": t, "subtasks": subtasks, "comments": comments}


@pm_tool(name="search_tasks", risk="L0", params=SearchTasksParams, label="搜索任务",
         description="按关键词搜索全租户任务（标题/描述），返回展示号与标题。")
async def search_tasks(p: SearchTasksParams) -> dict:
    return {"hits": await client().get("/tasks/search", params={"q": p.q})}


# ---------- L1 ----------

def _escalate_create(p: CreateTaskParams, ctx: RequestCtx) -> Risk:
    """指派给他人 → 升级为 L2（需确认）。"""
    return "L2" if p.assignee and not is_self(p.assignee) else "L1"


async def _before_create_task(p: CreateTaskParams) -> None:
    """升级为 L2 出卡前先解析负责人：多义/不存在在出卡前就报 AMBIGUOUS/NOT_FOUND，不等到 act。创建类没有现状，返回 None。"""
    if p.assignee and not is_self(p.assignee):
        await resolve_member(p.assignee)
    return None


@pm_tool(name="create_task", risk="L1", params=CreateTaskParams, label="创建任务",
         escalate=_escalate_create, before=_before_create_task,
         summarize=lambda p, b: f"创建任务「{p.title}」并指派给 {p.assignee or '我'}",
         description="创建任务（STORY/BUG/TASK）。缺省进待办、负责人默认是当前用户本人（不要为此追问）；"
                     "可指定天数、负责人、长期计划、迭代；用户明确说不指派时传 unassigned=true。记录类请用 create_record。")
async def create_task(p: CreateTaskParams) -> dict:
    key = await resolve_project_key(p.project_key)
    body: dict = {"type": p.type, "title": p.title}
    if p.description:
        body["description"] = p.description
    if p.points is not None:
        body["points"] = p.points
    if p.assignee:
        body["assigneeId"] = (await resolve_member(p.assignee))["userId"]
    elif not p.unassigned:
        body["assigneeId"] = current_ctx().user_id   # 缺省指派给自己：用户说"帮我建"不该再手动 assign
    if p.epic_name:
        body["epicId"] = (await resolve_epic(p.epic_name, key))["id"]
    if p.sprint:
        s = await resolve_sprint(p.sprint, key)
        if s.get("id") is not None:
            body["sprintId"] = s["id"]
    return await client().post(f"/projects/{key}/tasks", json=body)


# ---------- L2 ----------

async def _before_task(p) -> dict:
    return await resolve_task(p.task_key)


@pm_tool(name="update_task_status", risk="L2", params=UpdateTaskStatusParams, editable=("status",),
         label="修改任务状态", before=_before_task,
         summarize=lambda p, b: f"修改任务状态 {p.task_key}「{title_of(b)}」",
         description="修改任务状态。完成/做完→COMPLETED；归档/验收通过→DONE；开始做→IN_PROGRESS；含糊时先问用户。")
async def update_task_status(p: UpdateTaskStatusParams) -> dict:
    t = await resolve_task(p.task_key)
    return await client().patch(f"/tasks/{t['id']}", json={"status": p.status})


@pm_tool(name="update_task", risk="L2", params=UpdateTaskParams,
         editable=("title", "description", "points", "assignee"),
         label="修改任务", before=_before_task,
         summarize=lambda p, b: f"修改任务 {p.task_key}「{title_of(b)}」",
         description="修改任务的标题/描述/天数/负责人/长期计划；clear_assignee 取消指派，clear_epic 摘除长期计划。")
async def update_task(p: UpdateTaskParams) -> dict:
    t = await resolve_task(p.task_key)
    key = task_project_key(t)
    # PatchLong 三态：未提供的键不放进 json（不改）；clear_* → 显式 null（置空）
    body: dict = {}
    if p.title is not None:
        body["title"] = p.title
    if p.description is not None:
        body["description"] = p.description
    if p.points is not None:
        body["points"] = p.points
    if p.clear_assignee:
        body["assigneeId"] = None
    elif p.assignee:
        body["assigneeId"] = (await resolve_member(p.assignee))["userId"]
    if p.clear_epic:
        body["epicId"] = None
    elif p.epic_name:
        body["epicId"] = (await resolve_epic(p.epic_name, key))["id"]
    return await client().patch(f"/tasks/{t['id']}", json=body)


@pm_tool(name="move_task_to_sprint", risk="L2", params=MoveTaskParams, editable=("sprint",),
         label="移动任务到迭代", before=_before_task,
         summarize=lambda p, b: f"把任务 {p.task_key}「{title_of(b)}」移到 {p.sprint}",
         description="把任务移入某个迭代，或移回待办（sprint=backlog）。")
async def move_task_to_sprint(p: MoveTaskParams) -> dict:
    t = await resolve_task(p.task_key)
    s = await resolve_sprint(p.sprint, task_project_key(t))
    return await client().patch(f"/tasks/{t['id']}", json={"sprintId": s.get("id")})


# ---------- L3 ----------

@pm_tool(name="delete_task", risk="L3", params=TaskKeyParams, label="删除任务",
         summarize=lambda p, b: f"删除任务 {p.task_key}「{title_of(b)}」",
         description="删除任务（不可恢复）。")
async def delete_task(p: TaskKeyParams) -> dict:
    t = await resolve_task(p.task_key)
    await client().delete(f"/tasks/{t['id']}")
    return {"deleted": t.get("displayKey"), "title": t.get("title")}
