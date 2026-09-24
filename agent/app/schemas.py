"""对外契约模型（确认卡 / 决策 / SSE 事件）与 snake↔camel 边界转换。

Python 内部一律 snake_case；只有这里的 to_wire()/from_wire() 做转换，其它模块不得各写一套。
"""
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.harness.tool_guard import Risk

DecisionType = Literal["approve", "edit", "reject"]
SseType = Literal["text_delta", "tool_start", "tool_result", "confirm", "result_card", "done", "error"]


class FieldChange(BaseModel):
    field: str
    label: str
    before: Any = None
    after: Any = None


class Card(BaseModel):
    """确认卡（L2/L3）：数据全部来自工具 before() 读到的现状与模型入参，不来自模型文本。"""
    call_id: str
    tool: str
    risk: Risk
    title: str
    target: str                       # "PM-12 登录页接入短信验证"
    changes: list[FieldChange]
    impact: str
    editable: list[str]
    args: dict
    expires_at: datetime
    allowed_decisions: list[DecisionType]


class ResultCard(BaseModel):
    """结果卡（L1 创建类执行后回显；可撤销）。call_id 供前端做列表 key；path 是「打开」跳转路径。"""
    call_id: str
    tool: str
    title: str                        # "已创建 PM-58「补充注册页单元测试」"
    key: str | None = None            # 展示号（可撤销时前端据此发"撤销刚创建的 XX-0"）；无展示号时不输出
    summary: str = ""
    undoable: bool = False
    path: str | None = None
    data: Any = None


class ThreadCreated(BaseModel):
    thread_id: str


class ThreadSnapshot(BaseModel):
    """GET /threads/{id}：面向前端的简化历史 + 挂起卡（已 wire 化的 dict）。"""
    thread_id: str
    messages: list[dict]
    pending_cards: list[dict]


class ReauthInterrupt(BaseModel):
    """act 遇到后端 401 时在 reauth 节点 interrupt 的载荷；与确认卡区分（无 callId）。"""
    type: Literal["token_expired"] = "token_expired"


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_id: str
    type: DecisionType
    args: dict | None = None
    message: str | None = None


class Fallback(BaseModel):
    label: str
    path: str


class Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0


class SseEvent(BaseModel):
    """spec §5.2 的事件；按 type 只填相应字段，to_wire 时 None 字段不输出。"""
    model_config = ConfigDict(extra="forbid")
    type: SseType
    text: str | None = None
    call_id: str | None = None
    tool: str | None = None
    label: str | None = None
    risk: Risk | None = None
    ok: bool | None = None
    summary: str | None = None
    code: str | None = None
    message: str | None = None
    data: Any = None
    card: Card | ResultCard | dict | None = None
    usage: Usage | None = None
    fallback: Fallback | None = None


# ---------- 边界转换 ----------

_SNAKE_RE = re.compile(r"_([a-z0-9])")
_CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")


def _camel(key: str) -> str:
    return _SNAKE_RE.sub(lambda m: m.group(1).upper(), key)


def _snake(key: str) -> str:
    return _CAMEL_RE.sub("_", key).lower()


def _walk(node: Any, fn) -> Any:
    if isinstance(node, dict):
        return {fn(str(k)): _walk(v, fn) for k, v in node.items()}
    if isinstance(node, list):
        return [_walk(v, fn) for v in node]
    return node


def _wire_card_fields(card: dict) -> dict:
    """Card 里 editable / changes[].field 是"值"，但前端要拿它们去 card.args（键已 camel 化）取值，
    同一张卡必须同一风格：这里把它们也 camel 化（from_wire 对 edit 的 args 键做逆转换）。"""
    card = dict(card)
    if isinstance(card.get("editable"), list):
        card["editable"] = [_camel(str(f)) for f in card["editable"]]
    if isinstance(card.get("changes"), list):
        card["changes"] = [{**c, "field": _camel(str(c["field"]))} if isinstance(c, dict) and "field" in c else c
                           for c in card["changes"]]
    return card


def to_wire(model: BaseModel | dict) -> dict:
    """内部模型/字典 → 前端 JSON：递归 snake→camel，datetime → ISO(Z)，None 字段不输出。"""
    data = model.model_dump(mode="json", exclude_none=True) if isinstance(model, BaseModel) else model
    out = _walk(data, _camel)
    if isinstance(model, Card):
        out = _wire_card_fields(out)
    elif isinstance(model, SseEvent) and isinstance(model.card, Card):
        out["card"] = _wire_card_fields(out["card"])
    return out


def from_wire(data: dict) -> dict:
    """前端 JSON → 内部字典：递归 camel→snake（决策、edit 的 args）。"""
    return _walk(data, _snake)
