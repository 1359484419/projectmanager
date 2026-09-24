"""消息中心。"""
from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import NoParams


@pm_tool(name="list_notifications", risk="L0", params=NoParams, label="查询通知",
         description="列出最近的通知（任务指派等）与未读数。")
async def list_notifications(p: NoParams) -> dict:
    return await client().get("/notifications") or {"unreadCount": 0, "items": []}


@pm_tool(name="mark_notifications_read", risk="L1", params=NoParams, label="标记全部已读",
         description="把当前用户的所有通知标为已读。")
async def mark_notifications_read(p: NoParams) -> dict:
    await client().post("/notifications/read-all")
    return {"ok": True}
