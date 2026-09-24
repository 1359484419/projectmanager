"""子任务：创建、修改、删除（按标题定位）。"""
from pydantic import Field, model_validator

from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import StrictModel, TaskKeyField
from app.tools._resolve import resolve_subtask, resolve_task


class CreateSubtaskParams(StrictModel):
    task_key: str = TaskKeyField
    title: str = Field(min_length=1, description="子任务标题")


class UpdateSubtaskParams(StrictModel):
    task_key: str = TaskKeyField
    subtask_title: str = Field(description="要修改的子任务标题")
    done: bool | None = Field(default=None, description="是否完成")
    new_title: str | None = Field(default=None, description="新标题")

    @model_validator(mode="after")
    def _any_change(self):
        if self.done is None and self.new_title is None:
            raise ValueError("至少提供 done 或 new_title")
        return self


class DeleteSubtaskParams(StrictModel):
    task_key: str = TaskKeyField
    subtask_title: str = Field(description="要删除的子任务标题")


@pm_tool(name="create_subtask", risk="L1", params=CreateSubtaskParams, label="创建子任务",
         description="给任务添加一个子任务。")
async def create_subtask(p: CreateSubtaskParams) -> dict:
    t = await resolve_task(p.task_key)
    return await client().post(f"/tasks/{t['id']}/subtasks", json={"title": p.title})


async def _before_update_subtask(p: UpdateSubtaskParams) -> dict:
    t = await resolve_task(p.task_key)
    return await resolve_subtask(t, p.subtask_title)


@pm_tool(name="update_subtask", risk="L2", params=UpdateSubtaskParams, editable=("done", "new_title"),
         label="修改子任务", before=_before_update_subtask,
         summarize=lambda p, b: f"修改子任务「{(b or {}).get('title') or p.subtask_title}」（{p.task_key}）",
         description="勾选/取消完成或重命名子任务。")
async def update_subtask(p: UpdateSubtaskParams) -> dict:
    t = await resolve_task(p.task_key)
    s = await resolve_subtask(t, p.subtask_title)
    body: dict = {}
    if p.done is not None:
        body["done"] = p.done
    if p.new_title is not None:
        body["title"] = p.new_title
    return await client().patch(f"/subtasks/{s['id']}", json=body)


@pm_tool(name="delete_subtask", risk="L3", params=DeleteSubtaskParams, label="删除子任务",
         summarize=lambda p, b: f"删除子任务「{p.subtask_title}」（{p.task_key}）",
         description="删除任务下的一个子任务。")
async def delete_subtask(p: DeleteSubtaskParams) -> dict:
    t = await resolve_task(p.task_key)
    s = await resolve_subtask(t, p.subtask_title)
    await client().delete(f"/subtasks/{s['id']}")
    return {"deleted": s.get("title"), "taskKey": t.get("displayKey")}
