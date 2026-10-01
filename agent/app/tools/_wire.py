"""工具输出清洗（spec §7.3「模型只见展示号与名称」）：内部数字 id → 名称，剔除 id/projectId/rank/createdBy 等。

通用层：面板助手的 get_task / list_backlog / list_my_tasks / get_board 用；后续 MCP 子应用的输出也复用这里（评审架构决策
「MCP 输出统一 to_wire 清洗」）。只做字典变换，不发请求；名称索引由 load_name_index 一次拉齐（全是 GET）。
"""
from dataclasses import dataclass, field
from typing import Any

from app.tools._client import client

# 输出里一律剔除的内部键（入参侧对应的禁用清单见 tool_guard.FORBIDDEN_PARAM_NAMES）
INTERNAL_KEYS: frozenset[str] = frozenset({
    "id", "projectId", "sprintId", "assigneeId", "epicId", "taskId", "authorId", "actorId", "createdBy",
    "targetSprintId", "rank", "version", "doneBy",
})

# 内部 id 键 → (名称键, 索引方法名)
_NAME_OF: dict[str, tuple[str, str]] = {
    "assigneeId": ("assigneeName", "member_name"),
    "epicId": ("epicName", "epic_name"),
    "sprintId": ("sprintName", "sprint_name"),
    "authorId": ("authorName", "member_name"),
    "actorId": ("actorName", "member_name"),
    "doneBy": ("doneByName", "member_name"),
}


@dataclass
class NameIndex:
    members: list[dict] = field(default_factory=list)
    epics: list[dict] = field(default_factory=list)
    sprints: list[dict] = field(default_factory=list)

    def member_name(self, user_id: Any) -> str | None:
        for m in self.members:
            if m.get("userId") == user_id:
                return m.get("displayName") or m.get("email")
        return None

    def epic_name(self, epic_id: Any) -> str | None:
        return next((e.get("name") for e in self.epics if e.get("id") == epic_id), None)

    def sprint_name(self, sprint_id: Any) -> str | None:
        return next((s.get("name") for s in self.sprints if s.get("id") == sprint_id), None)


async def load_name_index(project_key: str, *, with_epics: bool = True, with_sprints: bool = True) -> NameIndex:
    """成员 / 长期计划 / 迭代列表各一次 GET（待办列表不需要迭代时可关掉）。"""
    c = client()
    members = await c.get("/members") or []
    epics = (await c.get(f"/projects/{project_key}/epics") or []) if with_epics else []
    sprints = (await c.get(f"/projects/{project_key}/sprints") or []) if with_sprints else []
    return NameIndex(members=members, epics=epics, sprints=sprints)


def strip_internal(node: Any) -> Any:
    """递归删掉 INTERNAL_KEYS（不解析名称；已带 xxxName 的对象直接用这个）。"""
    if isinstance(node, dict):
        return {k: strip_internal(v) for k, v in node.items() if k not in INTERNAL_KEYS}
    if isinstance(node, list):
        return [strip_internal(v) for v in node]
    return node


def _with_names(obj: dict, idx: NameIndex) -> dict:
    """浅层：对象里每个内部 id 键换成名称键（值 None 表示「没有/解析不到」，键保留让模型看得出"未指派"）。"""
    out: dict = {}
    for k, v in obj.items():
        if k in _NAME_OF:
            name_key, method = _NAME_OF[k]
            if name_key not in obj:
                out[name_key] = getattr(idx, method)(v) if v is not None else None
            continue
        if k in INTERNAL_KEYS:
            continue
        out[k] = v
    return out


def task_to_wire(task: dict, idx: NameIndex, project_key: str | None = None) -> dict:
    """TaskView / TaskBrief → 只含展示号、名称、状态等展示字段；缺 displayKey 时用 project_key + seq 补。"""
    out = _with_names(task, idx)
    if not out.get("displayKey") and project_key and task.get("seq") is not None:
        out["displayKey"] = f"{project_key}-{task['seq']}"
    return out


def tasks_to_wire(tasks: list[dict] | None, idx: NameIndex, project_key: str | None = None) -> list[dict]:
    return [task_to_wire(t, idx, project_key) for t in (tasks or [])]


def subtask_to_wire(subtask: dict, idx: NameIndex) -> dict:
    """子任务 → 展示字段：assigneeId/doneBy 换成姓名（解析不到为 None），内部 id 剔除。"""
    return _with_names(subtask, idx)


def comment_to_wire(comment: dict, idx: NameIndex) -> dict:
    return _with_names(comment, idx)
