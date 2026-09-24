"""成员：列表、邀请、移除。"""
from typing import Literal

from pydantic import Field

from app.harness.tool_guard import pm_tool
from app.tools._client import client
from app.tools._params import NoParams, StrictModel
from app.tools._resolve import resolve_member


class InviteMemberParams(StrictModel):
    role: Literal["ADMIN", "MEMBER"] = Field(description="被邀请人的角色")


class RemoveMemberParams(StrictModel):
    member: str = Field(description="成员姓名或邮箱")


@pm_tool(name="list_members", risk="L0", params=NoParams, label="查询成员",
         description="列出租户成员（姓名、邮箱、角色）。")
async def list_members(p: NoParams) -> dict:
    return {"members": await client().get("/members")}


@pm_tool(name="invite_member", risk="L3", params=InviteMemberParams, label="生成邀请链接",
         summarize=lambda p, b: f"生成一个 {p.role} 角色的邀请链接",
         description="生成邀请链接（仅管理员）；链接需要用户自行发给对方。")
async def invite_member(p: InviteMemberParams) -> dict:
    return await client().post("/invites", json={"role": p.role})


@pm_tool(name="remove_member", risk="L3", params=RemoveMemberParams, label="移除成员",
         summarize=lambda p, b: f"把成员「{p.member}」移出租户",
         description="把成员移出租户（仅管理员，不可逆）。")
async def remove_member(p: RemoveMemberParams) -> dict:
    m = await resolve_member(p.member)
    await client().delete(f"/members/{m['userId']}")
    return {"removed": m.get("displayName") or m.get("email")}
