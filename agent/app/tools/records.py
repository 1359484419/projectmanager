"""记录（RECORD）：创建者私有的备忘/发票类条目，可带到期提醒。"""
from pydantic import Field, field_validator

from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import ProjectKeyField, StrictModel, normalize_remind_at
from app.tools._resolve import resolve_project_key, resolve_task

TITLE_MAX = 80


class CreateRecordParams(StrictModel):
    project_key: str | None = ProjectKeyField
    content: str = Field(min_length=1, description="记录内容")
    remind_at: str | None = Field(default=None, description="到期提醒时间（ISO，如 2026-09-25T09:00；无时区按北京时间）")

    _r = field_validator("remind_at")(classmethod(lambda cls, v: normalize_remind_at(v)))


class RecordKeyParams(StrictModel):
    record_key: str = Field(description="记录的展示号，如 XX-0")


@pm_tool(name="create_record", risk="L1", params=CreateRecordParams, label="创建记录",
         description="创建一条私有记录（备忘/发票等，不进待办与看板），可设到期提醒。")
async def create_record(p: CreateRecordParams) -> dict:
    key = await resolve_project_key(p.project_key)
    body: dict = {"type": "RECORD", "title": p.content[:TITLE_MAX], "description": p.content}
    if p.remind_at:
        body["remindAt"] = p.remind_at
    return await client().post(f"/projects/{key}/tasks", json=body)


@pm_tool(name="dismiss_record_reminder", risk="L1", params=RecordKeyParams, label="关闭记录提醒",
         description="关闭某条记录的到期提醒（幂等）。")
async def dismiss_record_reminder(p: RecordKeyParams) -> dict:
    t = await resolve_task(p.record_key)
    await client().post(f"/records/{t['id']}/dismiss")
    return {"dismissed": t.get("displayKey"), "title": t.get("title")}
