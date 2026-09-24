"""工具入参公共基类与校验：严格模式（extra=forbid）、天数步进、时间归一化。

入参只用展示号/名称/枚举，绝不出现内部 id、slug、tenant。
"""
import re
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from pydantic import BaseModel, ConfigDict, Field

# 业务日界固定 Asia/Shanghai（与 Java BizTime 一致）
SHANGHAI = timezone(timedelta(hours=8))
QUARTER_RE = re.compile(r"^\d{4}-Q[1-4]$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class StrictModel(BaseModel):
    """所有工具入参的基类：多余字段直接校验失败，回给模型自纠。"""
    model_config = ConfigDict(extra="forbid")


class NoParams(StrictModel):
    pass  # 无参工具（不写 docstring，避免进 JSON schema 的 description）


ProjectKeyField = Field(default=None, description="项目 key（如 XX）。缺省用面板当前项目")
TaskKeyField = Field(description="任务展示号，如 XX-0")
SprintRefField = Field(default="current",
                       description="迭代：current=进行中的迭代，next=下一个已计划的迭代，backlog=待办（不属于任何迭代），或迭代名称")


def validate_points(v: float | None) -> float | None:
    """天数：0.5 ≤ p ≤ 5 且为 0.5 的倍数（与 Java TaskService.validatePoints 一致）。"""
    if v is None:
        return None
    try:
        d = Decimal(str(v))
    except InvalidOperation as exc:
        raise ValueError("天数必须是数字") from exc
    if d < Decimal("0.5") or d > Decimal("5") or (d * 2) != (d * 2).to_integral_value():
        raise ValueError("天数必须在 0.5 到 5 之间，且为 0.5 的倍数（如 0.5、1、1.5、2 … 5）")
    return float(d)


def validate_quarter(v: str | None) -> str | None:
    if v is not None and not QUARTER_RE.match(v):
        raise ValueError("季度格式应为 yyyy-Q[1-4]，如 2026-Q3")
    return v


def validate_date(v: str | None) -> str | None:
    if v is None:
        return None
    if not DATE_RE.match(v):
        raise ValueError("日期格式应为 yyyy-MM-dd")
    datetime.strptime(v, "%Y-%m-%d")
    return v


def normalize_remind_at(v: str | None) -> str | None:
    """ISO 时间 → Java Instant 字符串（UTC，Z 结尾）；无时区按 Asia/Shanghai 解释。"""
    if v is None:
        return None
    raw = v.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError("提醒时间格式应为 ISO，如 2026-09-25T09:00 或 2026-09-25 09:00") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SHANGHAI)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def title_of(before: dict | None) -> str:
    return str((before or {}).get("title", ""))
