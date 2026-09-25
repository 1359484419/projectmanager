"""MCP server（mcp 2.x MCPServer）：无状态 Streamable HTTP + JSON 响应，挂在 FastAPI 的 /mcp 下。

- 工具从 tools.mcp_profile() 注册：入参 schema / 输出 schema / annotations 自己给，执行走 _exec.run_tool（头 → 上下文 → 清洗）；
- resources 需要请求头才能回调后端，MCPServer 的静态资源不注入 Context，所以 read_resource 在这里整体接管 pm:// 前缀；
- prompts 只是文字模板（prompts.py）。
- 会话管理器（session_manager.run()）由 main.py 的 lifespan 启动，且先于 LLM/DB 初始化，两者互不影响。
"""
import json
from collections.abc import Iterable
from typing import Any

from mcp.server import MCPServer
from mcp.server.lowlevel.helper_types import ReadResourceContents
from mcp.server.mcpserver.exceptions import ResourceError
from mcp.server.mcpserver.tools.base import Tool
from mcp.server.mcpserver.utilities.func_metadata import ArgModelBase, FuncMetadata
from mcp.server.streamable_http_manager import StreamableHTTPASGIApp
from mcp.server.transport_security import TransportSecuritySettings
from mcp_types import CallToolResult
from pydantic import AnyUrl, ConfigDict
from starlette.applications import Starlette
from starlette.routing import Route

from app.mcp import prompts as prompt_templates
from app.mcp._exec import McpFail, run_tool, with_ctx
from app.mcp.tools import (ListMyWorkParams, McpBoardParams, McpToolDef, _call_reg, _reg, input_schema, list_my_work,
                           mcp_profile)
from app.tools._params import NoParams
from app.tools._wire import strip_internal

SERVER_NAME = "kuibu"
MCP_PATH = "/mcp"

INSTRUCTIONS = (
    "跬步（Kuibu）项目管理：任务 / 迭代（Sprint）/ 长期计划（Epic）/ 待办（Backlog）。"
    "任务用展示号指代（如 XX-0），项目用 key；负责人、迭代、长期计划一律用名称，工具不接受也不返回内部 id。"
    "先 list_projects 拿 project_key；写日报/周报用 list_my_work（缺省跨项目）。"
    "创建任务：先 create_tasks(dry_run=true) 拿预览，向用户展示清单并确认后再正式创建，单次不超过 20 条。"
    "close_sprint / start_sprint 不可逆：先向用户展示影响并取得明确同意，再带 confirm=true 调用。"
    "天数（points）0.5-5、步进 0.5，不确定就留空。失败返回 {code, message}：NOT_FOUND 先核对 key/展示号，"
    "AMBIGUOUS 从 candidates 里选一个再调。"
)

RESOURCE_PROJECTS = "pm://projects"
RESOURCE_ME_WORK = "pm://me/work"
RESOURCE_SPRINT_TEMPLATE = "pm://projects/{key}/sprints/current"
JSON_MIME = "application/json"


class PmMcpTool(Tool):
    """用 tool_guard 的参数模型与自定义输出 schema 注册的工具：绕过 MCPServer 从函数签名生成 schema。"""

    model_config = ConfigDict(arbitrary_types_allowed=True)
    definition: McpToolDef

    async def run(self, arguments: dict[str, Any], context: Any, convert_result: bool = False) -> CallToolResult:
        headers = getattr(context, "headers", None) if context is not None else None
        return await run_tool(self.definition.params, self.definition.call, arguments, headers)


def _tool(d: McpToolDef) -> PmMcpTool:
    return PmMcpTool(definition=d, fn=d.call, name=d.name, title=d.title, description=d.description,
                     parameters=input_schema(d.params),
                     fn_metadata=FuncMetadata(arg_model=ArgModelBase, output_schema=d.output_schema),
                     is_async=True, annotations=d.annotations)


class KuibuServer(MCPServer):
    """pm:// 资源读取需要请求头组装租户上下文，这里接管 read_resource；其它 URI 交回基类。"""

    async def read_resource(self, uri: AnyUrl | str, context: Any = None) -> Iterable[ReadResourceContents] | Any:
        u = str(uri)
        if not u.startswith("pm://"):
            return await super().read_resource(uri, context)
        headers = getattr(context, "headers", None) if context is not None else None
        try:
            data = await with_ctx(headers, lambda: _read_pm_resource(u))
        except McpFail as fail:
            raise ResourceError(json.dumps(fail.body, ensure_ascii=False)) from None
        return [ReadResourceContents(content=json.dumps(strip_internal(data), ensure_ascii=False, default=str),
                                     mime_type=JSON_MIME)]


async def _read_pm_resource(uri: str) -> dict:
    if uri == RESOURCE_PROJECTS:
        return await _reg("list_projects").fn(NoParams())
    if uri == RESOURCE_ME_WORK:
        return await list_my_work(ListMyWorkParams(scope="all"))
    parts = uri.removeprefix("pm://").split("/")
    if len(parts) == 4 and parts[0] == "projects" and parts[2:] == ["sprints", "current"] and parts[1]:
        return await _call_reg("get_board", McpBoardParams(project_key=parts[1], sprint="current"))
    raise McpFail("NOT_FOUND", f"资源 {uri} 不存在")


def _register_resources(server: MCPServer) -> None:
    """只为 resources/list 登记（读取已被 KuibuServer.read_resource 接管，这些函数不会被调用）。"""

    def _projects() -> str:  # pragma: no cover
        raise RuntimeError("handled by KuibuServer.read_resource")

    def _me_work() -> str:  # pragma: no cover
        raise RuntimeError("handled by KuibuServer.read_resource")

    def _current_sprint(key: str) -> str:  # pragma: no cover
        raise RuntimeError("handled by KuibuServer.read_resource")

    server.resource(RESOURCE_PROJECTS, name="projects", title="项目列表", mime_type=JSON_MIME,
                    description="当前租户的项目（key 与名称）")(_projects)
    server.resource(RESOURCE_ME_WORK, name="my_work", title="我的任务（跨项目）", mime_type=JSON_MIME,
                    description="指派给我的全部任务：当前/下一/全部已关闭迭代 + 待办，含 doneAt/updatedAt")(_me_work)
    server.resource(RESOURCE_SPRINT_TEMPLATE, name="current_sprint_board", title="当前迭代看板", mime_type=JSON_MIME,
                    description="项目 {key} 当前进行中迭代的四列看板")(_current_sprint)


def _register_prompts(server: MCPServer) -> None:
    server.prompt(name="daily_report", title="日报", description="按跬步的日报模板整理今天的工作（project_key 可选）")(
        prompt_templates.daily_report)
    server.prompt(name="weekly_report", title="周报", description="按跬步的周报模板整理本周期与上周期的工作（project_key 可选）")(
        prompt_templates.weekly_report)
    server.prompt(name="plan_from_notes", title="把工作记录整理成任务",
                  description="把口述/笔记整理成任务清单，先 dry_run 预览确认再创建")(prompt_templates.plan_from_notes)


def build_mcp_server() -> KuibuServer:
    server = KuibuServer(name=SERVER_NAME, title="跬步项目管理", instructions=INSTRUCTIONS,
                         tools=[_tool(d) for d in mcp_profile()])
    _register_resources(server)
    _register_prompts(server)
    return server


def build_mcp_app(server: MCPServer) -> Starlette:
    """无状态 + JSON 响应：Java 侧只做 PAT 校验 + 注入 X-PM-* + 直通 POST，不需要会话与 SSE。
    DNS rebinding 防护关掉：Host 由 Java 反代决定，鉴权不在这一层。"""
    return server.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True,
                                      transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))


def mcp_exact_route(server: MCPServer) -> Route:
    """Mount 只匹配 /mcp/…，裸 /mcp 会被 Starlette 307 到 /mcp/（Java 直通 POST 不跟随重定向）：同一会话管理器再挂一条精确路由。"""
    return Route(MCP_PATH, endpoint=StreamableHTTPASGIApp(server.session_manager))
