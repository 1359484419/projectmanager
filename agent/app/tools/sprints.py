"""迭代：查询、创建、容量、删除、开始、关闭。

L3（删除/开始/关闭）带 before：出卡前解析真实迭代（只 GET），卡片标题与 target 显示迭代名与起止日期，
而不是模型传的 current/next（评审 S1：红色不可逆卡片写着「关闭迭代「current」」）。
"""
from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import SHANGHAI, ProjectKeyField, SprintRefField, StrictModel, validate_date
from app.tools._resolve import (groups_with_keys, require_sprint_id, resolve_member, resolve_project_key,
                                resolve_sprint)
from app.tools._wire import strip_internal


# ---------- 参数 ----------

class ListSprintsParams(StrictModel):
    project_key: str | None = ProjectKeyField
    with_tasks: bool = Field(default=False, description="是否附带每个迭代的任务摘要")


class GetBoardParams(StrictModel):
    project_key: str | None = ProjectKeyField
    sprint: str = SprintRefField


class CreateSprintParams(StrictModel):
    project_key: str | None = ProjectKeyField
    name: str | None = Field(default=None, description="迭代名称，缺省由系统按序号命名")
    length: Literal["WEEK_1", "WEEK_2", "MONTH_1"] | None = Field(default=None, description="时长，缺省用项目默认")
    start_date: str | None = Field(default=None,
                                   description="开始日期 yyyy-MM-dd；缺省为上一个迭代结束日的次日（不早于今天），没有迭代时为今天")

    _d = field_validator("start_date")(classmethod(lambda cls, v: validate_date(v)))


class SetCapacityParams(StrictModel):
    project_key: str | None = ProjectKeyField
    sprint: str = SprintRefField
    member: str = Field(description="成员姓名或邮箱；me/我 表示自己")
    capacity: int = Field(ge=0, le=99, description="该成员在此迭代的可用天数")


class SprintNameParams(StrictModel):
    project_key: str | None = ProjectKeyField
    sprint_name: str = Field(description="迭代名称，或 current/next")


class CloseSprintParams(StrictModel):
    project_key: str | None = ProjectKeyField
    sprint: str = SprintRefField
    unfinished: Literal["backlog", "move"] = Field(description="未完成任务的去向：backlog=移回待办；move=移到 target_sprint")
    target_sprint: str | None = Field(default=None, description="unfinished=move 时的目标迭代（next 或名称）")

    @model_validator(mode="after")
    def _need_target(self):
        if self.unfinished == "move" and not self.target_sprint:
            raise ValueError("unfinished=move 时必须提供 target_sprint")
        return self


# ---------- L0 ----------

@pm_tool(name="list_sprints", risk="L0", params=ListSprintsParams, label="查询迭代列表",
         description="列出项目的迭代（新的在前），含状态 PLANNED/ACTIVE/CLOSED 与起止日期。")
async def list_sprints(p: ListSprintsParams) -> dict:
    key = await resolve_project_key(p.project_key)
    data = await client().get(f"/projects/{key}/sprints",
                              params={"withTasks": "true" if p.with_tasks else "false"})
    return {"projectKey": key, "sprints": data}


@pm_tool(name="get_board", risk="L0", params=GetBoardParams, label="查询看板",
         description="看板：某个迭代内的任务按 TODO/IN_PROGRESS/COMPLETED/DONE 四列展示。")
async def get_board(p: GetBoardParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = await require_sprint_id(p.sprint, key)
    data = await client().get(f"/sprints/{s['id']}/board") or {}
    return {"projectKey": key, **strip_internal({k: v for k, v in data.items() if k != "columns"}),
            "columns": strip_internal(groups_with_keys(key, data.get("columns")))}


# ---------- L1 ----------

def _today() -> date:
    return datetime.now(SHANGHAI).date()


def default_start_date(sprints: list[dict], today: date) -> str | None:
    """缺省开始日期 = 最晚结束日的次日，但不早于今天；没有任何带结束日的迭代 → None（交给后端缺省=今天）。"""
    ends = [date.fromisoformat(str(s["endDate"])) for s in sprints or [] if s.get("endDate")]
    if not ends:
        return None
    return max(max(ends) + timedelta(days=1), today).isoformat()


@pm_tool(name="create_sprint", risk="L1", params=CreateSprintParams, label="创建迭代",
         description="创建一个已计划（PLANNED）的迭代；名称/时长/开始日期都可缺省，"
                     "开始日期缺省为上一个迭代结束日的次日（不早于今天）。")
async def create_sprint(p: CreateSprintParams) -> dict:
    key = await resolve_project_key(p.project_key)
    body: dict = {}
    if p.name:
        body["name"] = p.name
    if p.length:
        body["length"] = p.length
    if p.start_date:
        body["startDate"] = p.start_date
    else:
        existing = await client().get(f"/projects/{key}/sprints") or []
        if start := default_start_date(existing, _today()):
            body["startDate"] = start
    return await client().post(f"/projects/{key}/sprints", json=body)


# ---------- L2 ----------

async def _before_set_capacity(p: SetCapacityParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = await require_sprint_id(p.sprint, key)
    m = await resolve_member(p.member)
    rows = await client().get(f"/sprints/{s['id']}/capacity") or []
    row = next((r for r in rows if r.get("userId") == m.get("userId")), {})
    return {"sprint": s.get("name"), "member": m.get("displayName"), "capacity": row.get("capacity"),
            "assignedPoints": row.get("assignedPoints")}


@pm_tool(name="set_capacity", risk="L2", params=SetCapacityParams, editable=("capacity",),
         label="设置迭代容量", before=_before_set_capacity,
         summarize=lambda p, b: f"设置 {(b or {}).get('sprint') or p.sprint} 中 {(b or {}).get('member') or p.member} 的容量",
         description="设置某成员在某迭代的可用天数（容量）。")
async def set_capacity(p: SetCapacityParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = await require_sprint_id(p.sprint, key)
    m = await resolve_member(p.member)
    return await client().put(f"/sprints/{s['id']}/capacity/{m['userId']}", json={"capacity": p.capacity})


# ---------- L3 ----------

def _sprint_label(b: dict | None, fallback: str) -> str:
    """卡片标题用真实迭代名（before 解析到的），解析不到才退回模型传的引用。"""
    return str((b or {}).get("name") or fallback)


async def _before_sprint(p: SprintNameParams) -> dict:
    """出卡前解析迭代（只 GET）：不存在/多义在出卡前就报，卡片显示真实名称与日期。"""
    key = await resolve_project_key(p.project_key)
    return await require_sprint_id(p.sprint_name, key)


async def _before_close(p: CloseSprintParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = dict(await require_sprint_id(p.sprint, key))
    if p.unfinished == "move":
        s["targetSprintName"] = (await require_sprint_id(p.target_sprint or "next", key)).get("name")
    return s


@pm_tool(name="delete_sprint", risk="L3", params=SprintNameParams, label="删除迭代", before=_before_sprint,
         summarize=lambda p, b: f"删除迭代「{_sprint_label(b, p.sprint_name)}」（其下任务移回待办）",
         description="删除一个迭代（进行中的迭代不可删）；其下任务自动移回待办。")
async def delete_sprint(p: SprintNameParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = await require_sprint_id(p.sprint_name, key)
    await client().delete(f"/sprints/{s['id']}")
    return {"deleted": s.get("name"), "projectKey": key}


@pm_tool(name="start_sprint", risk="L3", params=SprintNameParams, label="开始迭代", before=_before_sprint,
         summarize=lambda p, b: f"开始迭代「{_sprint_label(b, p.sprint_name)}」",
         description="把一个已计划的迭代设为进行中（同一项目同时只能有一个进行中的迭代）。")
async def start_sprint(p: SprintNameParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = await require_sprint_id(p.sprint_name, key)
    return await client().post(f"/sprints/{s['id']}/start")


@pm_tool(name="close_sprint", risk="L3", params=CloseSprintParams, label="关闭迭代", before=_before_close,
         summarize=lambda p, b: f"关闭迭代「{_sprint_label(b, p.sprint)}」，未完成任务"
                                f"{'移到 ' + str((b or {}).get('targetSprintName') or p.target_sprint) if p.unfinished == 'move' else '移回待办'}",
         description="关闭迭代；未完成任务移回待办（backlog）或移到目标迭代（move + target_sprint）。不可逆。")
async def close_sprint(p: CloseSprintParams) -> dict:
    key = await resolve_project_key(p.project_key)
    s = await require_sprint_id(p.sprint, key)
    body: dict = {"unfinished": p.unfinished.upper()}
    if p.unfinished == "move":
        target = await require_sprint_id(p.target_sprint or "next", key)
        body["targetSprintId"] = target["id"]
    return await client().post(f"/sprints/{s['id']}/close", json=body)
