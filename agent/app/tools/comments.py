"""评论。"""
from pydantic import Field

from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import StrictModel, TaskKeyField
from app.tools._resolve import resolve_task


class AddCommentParams(StrictModel):
    task_key: str = TaskKeyField
    body: str = Field(min_length=1, description="评论内容")


@pm_tool(name="add_comment", risk="L1", params=AddCommentParams, label="添加评论",
         description="给任务添加一条评论。")
async def add_comment(p: AddCommentParams) -> dict:
    t = await resolve_task(p.task_key)
    return await client().post(f"/tasks/{t['id']}/comments", json={"body": p.body})
