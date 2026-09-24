"""长期计划（Epic）：查询、创建、修改、删除。"""
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import ProjectKeyField, StrictModel, validate_quarter
from app.tools._resolve import resolve_epic, resolve_project_key


class ListEpicsParams(StrictModel):
    project_key: str | None = ProjectKeyField


class CreateEpicParams(StrictModel):
    project_key: str | None = ProjectKeyField
    name: str = Field(min_length=1, description="长期计划名称")
    quarter: str | None = Field(default=None, description="季度，格式 yyyy-Q[1-4]")
    description: str | None = None

    _q = field_validator("quarter")(classmethod(lambda cls, v: validate_quarter(v)))


class UpdateEpicParams(StrictModel):
    project_key: str | None = ProjectKeyField
    epic_name: str = Field(description="要修改的长期计划名称")
    name: str | None = Field(default=None, description="新名称")
    description: str | None = None
    quarter: str | None = Field(default=None, description="季度 yyyy-Q[1-4]")
    status: Literal["OPEN", "DONE"] | None = None

    _q = field_validator("quarter")(classmethod(lambda cls, v: validate_quarter(v)))

    @model_validator(mode="after")
    def _any_change(self):
        if not any(v is not None for v in (self.name, self.description, self.quarter, self.status)):
            raise ValueError("至少提供一个要修改的字段：name/description/quarter/status")
        return self


class EpicNameParams(StrictModel):
    project_key: str | None = ProjectKeyField
    epic_name: str = Field(description="长期计划名称")


@pm_tool(name="list_epics", risk="L0", params=ListEpicsParams, label="查询长期计划",
         description="列出项目的长期计划（Epic）及季度与状态。")
async def list_epics(p: ListEpicsParams) -> dict:
    key = await resolve_project_key(p.project_key)
    return {"projectKey": key, "epics": await client().get(f"/projects/{key}/epics")}


@pm_tool(name="create_epic", risk="L1", params=CreateEpicParams, label="创建长期计划",
         description="创建长期计划（Epic）。")
async def create_epic(p: CreateEpicParams) -> dict:
    key = await resolve_project_key(p.project_key)
    body: dict = {"name": p.name}
    if p.quarter:
        body["quarter"] = p.quarter
    if p.description:
        body["description"] = p.description
    return await client().post(f"/projects/{key}/epics", json=body)


async def _before_update_epic(p: UpdateEpicParams) -> dict:
    key = await resolve_project_key(p.project_key)
    return await resolve_epic(p.epic_name, key)


@pm_tool(name="update_epic", risk="L2", params=UpdateEpicParams, label="修改长期计划",
         editable=("name", "description", "quarter", "status"), before=_before_update_epic,
         summarize=lambda p, b: f"修改长期计划「{(b or {}).get('name') or p.epic_name}」",
         description="修改长期计划的名称/描述/季度/状态。")
async def update_epic(p: UpdateEpicParams) -> dict:
    key = await resolve_project_key(p.project_key)
    e = await resolve_epic(p.epic_name, key)
    body = {k: v for k, v in (("name", p.name), ("description", p.description),
                              ("quarter", p.quarter), ("status", p.status)) if v is not None}
    return await client().patch(f"/projects/{key}/epics/{e['id']}", json=body)


@pm_tool(name="delete_epic", risk="L3", params=EpicNameParams, label="删除长期计划",
         summarize=lambda p, b: f"删除长期计划「{p.epic_name}」（其下任务保留，仅解除关联）",
         description="删除长期计划；其下任务不删除，只解除关联。")
async def delete_epic(p: EpicNameParams) -> dict:
    key = await resolve_project_key(p.project_key)
    e = await resolve_epic(p.epic_name, key)
    await client().delete(f"/projects/{key}/epics/{e['id']}")
    return {"deleted": e.get("name"), "projectKey": key}
