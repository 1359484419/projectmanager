"""确认卡生成：L2 先读现状（spec.before）再做逐字段 before/after diff；L3 只标出对象。

卡片上的 before 值就是刚读到的现状，用户看到的是真实数据（spec §7.4）。
"""
from datetime import datetime, timedelta

from pydantic import BaseModel

from app.harness.auth import RequestCtx
from app.harness.tool_guard import Risk, ToolSpec
from app.schemas import Card, DecisionType, FieldChange
from app.tools._resolve import resolve_task

# 入参字段 → 卡片中文标签
FIELD_LABELS: dict[str, str] = {
    "status": "状态", "title": "标题", "new_title": "标题", "description": "描述", "points": "天数",
    "assignee": "负责人", "epic_name": "长期计划", "sprint": "迭代", "done": "完成", "capacity": "容量",
    "name": "名称", "quarter": "季度", "role": "角色", "unfinished": "未完成任务处理",
    "target_sprint": "目标迭代", "type": "类型", "content": "内容", "remind_at": "提醒时间",
    "length": "周期", "start_date": "开始日期", "body": "内容",
}

# 只用于定位对象、不算"变更"的入参（通用 + 按工具）
_LOCATORS: frozenset[str] = frozenset({"task_key", "project_key", "record_key", "subtask_title", "sprint_name", "member"})
_LOCATORS_BY_TOOL: dict[str, frozenset[str]] = {
    "update_epic": frozenset({"epic_name"}),
    "delete_epic": frozenset({"epic_name"}),
    "set_capacity": frozenset({"sprint"}),
    "close_sprint": frozenset({"sprint"}),
}

# clear_xxx=True 表示把 xxx 置空
_CLEAR_PREFIX = "clear_"

# 入参字段在现状对象（Java View）里对应的键（找不到时依次尝试 camelCase / 原名）
_BEFORE_KEYS: dict[str, tuple[str, ...]] = {
    "assignee": ("assigneeName", "assigneeId"),
    "epic_name": ("epicName", "epicId"),
    "sprint": ("sprintName", "sprintId"),
    "new_title": ("title",),
    "done": ("done",),
}

IMPACT_BY_RISK: dict[str, str] = {
    "L2": "会立即生效并记入任务活动流（可能触发看板/燃尽图更新与通知）；可再次修改回退。",
    "L3": "此操作不可恢复，请确认目标无误。",
}


def _camel(key: str) -> str:
    parts = key.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _before_value(before: dict | None, field: str):
    if not before:
        return None
    for k in (*_BEFORE_KEYS.get(field, ()), _camel(field), field):
        if k in before:
            return before[k]
    return None


def _target(before: dict | None, args: BaseModel) -> str:
    b = before or {}
    key = b.get("displayKey")
    name = b.get("title") or b.get("name") or b.get("displayName")
    if key and name:
        return f"{key} {name}"
    if key or name:
        return str(key or name)
    # 现状不可得（L3 无 before）：用定位字段拼；创建类没有定位字段 → 用标题/名称
    parts = [str(getattr(args, f)) for f in ("task_key", "record_key", "sprint_name", "epic_name", "member")
             if f in args.model_fields_set and getattr(args, f)]
    if not parts:
        parts = [str(getattr(args, f)) for f in ("title", "name") if f in args.model_fields_set and getattr(args, f)]
    return " ".join(parts)


def compute_changes(spec: ToolSpec, args: BaseModel, before: dict | None) -> list[FieldChange]:
    """只列模型显式提供的字段；clear_* → after=None；定位字段不算变更。"""
    locators = _LOCATORS | _LOCATORS_BY_TOOL.get(spec.name, frozenset())
    changes: list[FieldChange] = []
    for field in args.model_fields_set:
        if field in locators:
            continue
        value = getattr(args, field)
        if field.startswith(_CLEAR_PREFIX):
            if value is True:
                target = field[len(_CLEAR_PREFIX):]
                changes.append(FieldChange(field=target, label=FIELD_LABELS.get(target, target),
                                           before=_before_value(before, target), after=None))
            continue
        if value is None:
            continue
        changes.append(FieldChange(field=field, label=FIELD_LABELS.get(field, field),
                                   before=_before_value(before, field), after=value))
    changes.sort(key=lambda c: c.field)
    return changes


async def _default_before(args: BaseModel) -> dict | None:
    """L3 工具没有 before：若入参带任务/记录展示号，读一次现状让卡片能显示标题（GET，幂等）。"""
    for f in ("task_key", "record_key"):
        if f in args.model_fields_set and getattr(args, f):
            return await resolve_task(getattr(args, f))
    return None


def card_expired(expires_at: datetime | str, now: datetime) -> bool:
    """确认卡 TTL 判定：guard（决策时）与 act（执行前）两道门共用，避免各写一套。"""
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    return now > expires_at


async def build_card(spec: ToolSpec, args: BaseModel, call_id: str, ctx: RequestCtx, now: datetime,
                     ttl: int, *, note: str | None = None, risk: Risk | None = None) -> Card:
    """before = await spec.before(args)（若有，必须是无副作用的 GET）；note 追加到 impact（如 409 重出卡）。

    risk 是 guard 算出的实际等级（escalate 后可能高于声明等级）：卡片样式与 changes 都按它来；
    声明 L1 升级到 L2 的创建类没有现状，changes 逐字段 before=None、after=入参。
    """
    before = await spec.before(args) if spec.before is not None else await _default_before(args)
    title = spec.summarize(args, before) if spec.summarize is not None else f"{spec.label} {_target(before, args)}"
    editable = list(spec.editable)
    allowed: list[DecisionType] = ["approve", "edit", "reject"] if editable else ["approve", "reject"]
    effective: Risk = risk or spec.risk
    impact_risk = effective if effective in IMPACT_BY_RISK else "L2"
    impact = IMPACT_BY_RISK[impact_risk]
    if note:
        impact = f"{note}。{impact}"
    diff_before = before if spec.risk == "L2" else None
    return Card(call_id=call_id, tool=spec.name, risk=effective, title=title, target=_target(before, args),
                changes=compute_changes(spec, args, diff_before) if effective == "L2" else [],
                impact=impact, editable=editable, args=args.model_dump(mode="json", exclude_unset=True),
                expires_at=now + timedelta(seconds=ttl), allowed_decisions=allowed)
