"""兜底（spec §6.4/§7.7）：错误码 → 人话文案；工具 → 前端手动入口（路径对齐 App.tsx 路由）。"""
from app.harness.auth import RequestCtx
from app.schemas import Fallback, SseEvent

ERROR_TEXT: dict[str, str] = {
    "LLM_UNAVAILABLE": "助手暂时不可用（模型服务无响应），你可以先手动操作。",
    "STREAM_INTERRUPTED": "回复中途断开了，已保留已输出的内容；可以重发一次。",
    "TOKEN_EXPIRED": "登录已过期，正在自动刷新后重试。",
    "MAX_ROUNDS": "步骤太多，已停止本次操作；请把任务拆小一点再试。",
    "MAX_TOKENS": "本次对话内容过长，已停止；请新开会话再试。",
    "REPEATED_CALLS": "检测到重复调用同一工具且参数相同，已停止本次操作，请换个说法或手动处理。",
    "ASSISTANT_TIMEOUT": "助手处理超时，已停止；请稍后重试或手动操作。",
    "CARD_EXPIRED": "确认卡已过期，未执行；请重新发起。",
    "INVALID_PARAMS": "助手多次给出的参数不符合要求，已停止本次操作；请换个说法或手动处理。",
    "UNKNOWN_OUTCOME": "上一次执行在等待后端响应时被中断，该操作可能已生效；请先查询核对现状，不要直接重做。",
    "ASSISTANT_ERROR": "助手内部出错，已停止；请稍后重试或手动操作。",
}

# 路由段 → 按钮文案
_LABELS: dict[str, str] = {
    "dashboard": "去仪表盘查看", "backlog": "去待办手动操作", "board": "去看板手动操作", "sprints": "去迭代列表手动操作",
    "planning": "去迭代规划手动操作", "roadmap": "去长期计划手动操作", "records": "去记录页手动操作",
    "admin": "去成员管理手动操作",
}

_ROUTE_BY_TOOL: dict[str, str] = {
    "list_projects": "dashboard", "get_dashboard": "dashboard",
    "list_notifications": "dashboard", "mark_notifications_read": "dashboard",
    "list_backlog": "backlog", "create_task": "backlog",
    "get_board": "board", "list_my_tasks": "board", "get_task": "board", "search_tasks": "board",
    "create_subtask": "board", "add_comment": "board",
    "update_task_status": "board", "update_task": "board", "move_task_to_sprint": "board", "update_subtask": "board",
    "delete_task": "board", "delete_subtask": "board",
    "list_sprints": "sprints", "delete_sprint": "sprints",
    "create_sprint": "planning", "start_sprint": "planning", "close_sprint": "planning", "set_capacity": "planning",
    "list_epics": "roadmap", "create_epic": "roadmap", "update_epic": "roadmap", "delete_epic": "roadmap",
    "create_record": "records", "dismiss_record_reminder": "records",
    "list_members": "admin", "invite_member": "admin", "remove_member": "admin",
}


def manual_path(tool: str, ctx: RequestCtx) -> tuple[str, str]:
    """(label, path)；未知工具退回仪表盘，永不 KeyError。"""
    route = _ROUTE_BY_TOOL.get(tool, "dashboard")
    return _LABELS[route], f"/t/{ctx.tenant}/{route}"


def error_event(code: str, ctx: RequestCtx, *, tool: str | None = None, message: str | None = None) -> SseEvent:
    label, path = manual_path(tool or "", ctx)
    return SseEvent(type="error", code=code, message=message or ERROR_TEXT.get(code) or ERROR_TEXT["ASSISTANT_ERROR"],
                    fallback=Fallback(label=label, path=path))
