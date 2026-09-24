"""工具目录：spec §8 的 33 个工具名是唯一清单；load_all 装载并做启动期完整性断言（fail-closed）。"""
import importlib
import sys

from app.harness import tool_guard as tg

_MODULES: tuple[str, ...] = ("projects", "sprints", "epics", "tasks", "subtasks", "comments",
                             "records", "members", "notifications")

EXPECTED_TOOLS: frozenset[str] = frozenset({
    # L0
    "list_projects", "get_dashboard", "list_sprints", "get_board", "list_backlog", "list_my_tasks",
    "get_task", "search_tasks", "list_epics", "list_members", "list_notifications",
    # L1
    "create_task", "create_subtask", "add_comment", "create_record", "create_sprint", "create_epic",
    "mark_notifications_read", "dismiss_record_reminder",
    # L2
    "update_task_status", "update_task", "move_task_to_sprint", "update_subtask", "update_epic",
    "set_capacity",
    # L3
    "delete_task", "delete_subtask", "delete_epic", "delete_sprint", "start_sprint", "close_sprint",
    "invite_member", "remove_member",
})


def load_all() -> None:
    """导入全部工具模块触发注册；幂等（注册表被清空后可重建）；最后断言与目录完全一致。"""
    for name in _MODULES:
        qualified = f"app.tools.{name}"
        mod = sys.modules.get(qualified) or importlib.import_module(qualified)
        # 模块已导入但注册表被清（如测试夹具）→ 从函数上的 spec 声明式重建
        for obj in vars(mod).values():
            spec = getattr(obj, tg.SPEC_ATTR, None)
            if isinstance(spec, tg.ToolSpec) and spec.name not in tg.REGISTRY:
                tg.REGISTRY[spec.name] = spec
    tg.assert_registry_complete(set(EXPECTED_TOOLS))
