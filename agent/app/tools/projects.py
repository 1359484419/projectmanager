"""项目：只读（项目级写操作本期不提供，留给 Web）。"""
from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import NoParams, ProjectKeyField, StrictModel
from app.tools._resolve import groups_with_keys, resolve_project_key


class GetDashboardParams(StrictModel):
    project_key: str | None = ProjectKeyField


@pm_tool(name="list_projects", risk="L0", params=NoParams, label="查询项目列表",
         description="列出当前租户的所有项目（key 与名称）。")
async def list_projects(p: NoParams) -> dict:
    return {"projects": await client().get("/projects")}


@pm_tool(name="get_dashboard", risk="L0", params=GetDashboardParams, label="查询项目概览",
         description="项目概览：当前进行中迭代的四态任务分组与完成百分比；没有进行中的迭代时 sprint 为 null。")
async def get_dashboard(p: GetDashboardParams) -> dict:
    key = await resolve_project_key(p.project_key)
    data = await client().get(f"/projects/{key}/dashboard") or {}
    return {"projectKey": key, **data, "groups": groups_with_keys(key, data.get("groups"))}
