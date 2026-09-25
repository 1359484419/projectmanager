"""ToolGuard：工具风险分级注册表（fail-closed）。

等级是唯一真相源：guard 节点的分级判定、act 执行前的二次核对、前端卡片样式都读这里。
未显式声明等级的工具无法注册；启动期用 assert_registry_complete 断言目录与注册表一致。
"""
import copy
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, get_args

from pydantic import BaseModel

from app.harness.auth import RequestCtx

Risk = Literal["L0", "L1", "L2", "L3"]
_RISKS: tuple[str, ...] = get_args(Risk)
_RISK_ORDER: dict[str, int] = {r: i for i, r in enumerate(_RISKS)}
_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

# 工具入参里禁止出现的参数名（模型不得接触内部 id / 租户）
FORBIDDEN_PARAM_NAMES: frozenset[str] = frozenset({"slug", "tenant", "id", "tenant_id", "tenantId"})


@dataclass
class ToolSpec:
    name: str
    risk: Risk
    description: str
    params: type[BaseModel]
    fn: Callable[..., Awaitable[Any]]                     # async fn(params) -> dict
    editable: tuple[str, ...] = ()                        # edit 决策允许修改的字段
    escalate: Callable[[BaseModel, RequestCtx], Risk] | None = None
    summarize: Callable[[BaseModel, dict | None], str] | None = None   # 确认卡标题
    before: Callable[[BaseModel], Awaitable[dict | None]] | None = None  # L2：读现状供 diff；升级类可只做预检返回 None
    label: str = field(default="")                        # 工具进度行文案（缺省用 description 首句）


REGISTRY: dict[str, ToolSpec] = {}

# 装饰后的函数上挂的属性名；catalog.load_all 据此幂等重建注册表
SPEC_ATTR = "__pm_tool__"


def pm_tool(*, name: str, risk: Risk, description: str, params: type[BaseModel],
            editable: tuple[str, ...] = (),
            escalate: Callable[[BaseModel, RequestCtx], Risk] | None = None,
            summarize: Callable[[BaseModel, dict | None], str] | None = None,
            before: Callable[[BaseModel], Awaitable[dict | None]] | None = None,
            label: str = ""):
    """注册工具。重名 / 非法名 / 非法等级 → ValueError（fail-closed，宁可启动失败）。"""
    if not _NAME_RE.match(name):
        raise ValueError(f"工具名 {name!r} 不满足 ^[a-zA-Z0-9_-]+$")
    if risk not in _RISK_ORDER:
        raise ValueError(f"工具 {name} 的风险等级 {risk!r} 非法，必须是 {list(_RISKS)}")
    if not (isinstance(params, type) and issubclass(params, BaseModel)):
        raise ValueError(f"工具 {name} 的 params 必须是 pydantic BaseModel 子类")
    if name in REGISTRY:
        raise ValueError(f"工具 {name} 重复注册")
    for bad in editable:
        if bad not in params.model_fields:
            raise ValueError(f"工具 {name} 的 editable 字段 {bad!r} 不在 params 中")

    def deco(fn: Callable[..., Awaitable[Any]]):
        spec = ToolSpec(name=name, risk=risk, description=description, params=params, fn=fn,
                        editable=tuple(editable), escalate=escalate, summarize=summarize,
                        before=before, label=label or description.split("。")[0][:30])
        REGISTRY[name] = spec
        setattr(fn, SPEC_ATTR, spec)
        return fn

    return deco


def effective_risk(spec: ToolSpec, args: BaseModel, ctx: RequestCtx) -> Risk:
    """实际等级 = max(声明等级, escalate 结果)；escalate 只能升不能降。"""
    risk: str = spec.risk
    if spec.escalate is not None:
        raised = spec.escalate(args, ctx)
        if raised not in _RISK_ORDER:
            raise ValueError(f"工具 {spec.name} 的 escalate 返回非法等级 {raised!r}")
        if _RISK_ORDER[raised] > _RISK_ORDER[risk]:
            risk = raised
    return risk  # type: ignore[return-value]


def needs_approval(risk: Risk) -> bool:
    return _RISK_ORDER[risk] >= _RISK_ORDER["L2"]


# 这些键的值是「名称 → schema」映射：里面的 "title" 是属性名（如任务标题），不是 pydantic 元数据
_SCHEMA_MAPS: frozenset[str] = frozenset({"properties", "$defs", "definitions"})


def _strip_titles(node: Any, *, in_map: bool = False) -> Any:
    """递归删掉 pydantic 生成的 title 元数据（对模型是噪音），但保留 properties/$defs 里名为 title 的属性。"""
    if isinstance(node, dict):
        return {k: _strip_titles(v, in_map=(k in _SCHEMA_MAPS and not in_map))
                for k, v in node.items() if in_map or k != "title"}
    if isinstance(node, list):
        return [_strip_titles(v) for v in node]
    return node


def tool_schema(spec: ToolSpec) -> dict:
    schema = copy.deepcopy(spec.params.model_json_schema())
    schema = _strip_titles(schema)
    schema.setdefault("type", "object")
    schema.setdefault("properties", {})
    return schema


def openai_tools() -> list[dict]:
    """注册表 → OpenAI chat.completions 的 tools 参数。"""
    return [
        {"type": "function",
         "function": {"name": spec.name, "description": spec.description,
                      "parameters": tool_schema(spec)}}
        for spec in REGISTRY.values()
    ]


def assert_registry_complete(expected_names: set[str]) -> None:
    """启动期断言：注册表与目录一一对应，缺一个或多一个都拒绝启动。"""
    actual = set(REGISTRY)
    missing = expected_names - actual
    extra = actual - expected_names
    if missing or extra:
        raise RuntimeError(
            f"工具注册表与目录不一致：缺少 {sorted(missing)}，多出 {sorted(extra)}")
    for name in sorted(expected_names):
        spec = REGISTRY[name]
        if needs_approval(spec.risk) and spec.summarize is None:
            raise RuntimeError(f"L2/L3 工具 {name} 缺少 summarize（确认卡标题）")
        if spec.risk == "L2" and spec.before is None:
            raise RuntimeError(f"L2 工具 {name} 缺少 before（读现状供 diff）")
