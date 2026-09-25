"""图组装：START → reason ─(有 tool_calls)→ prepare → guard → act ⟲ → observe ─→ reason；无 tool_calls / 达上限 → END。

prepare 读现状生成卡片（落 checkpoint），guard 只做 interrupt；对外语义仍是"在 guard 挂起"。
act 每个写操作前后各落一次 checkpoint（自环），后端 401 时经 reauth 节点 interrupt 等刷新令牌后续跑。

ReAct 由条件边强制：模型只有经 act→observe 拿到真实 tool 消息才能继续，口头宣称无效。
"""
from collections.abc import Callable
from datetime import UTC, datetime

from langgraph.graph import END, START, StateGraph

from app.harness.tool_guard import openai_tools
from app.llm import LLM
from app.nodes.act import make_act_node, make_reauth_node, route_after_act
from app.nodes.guard import make_guard_node, make_prepare_node
from app.nodes.observe import make_observe_node
from app.nodes.reason import make_reason_node
from app.settings import Settings
from app.state import AgentState
from app.tools import catalog


def route_after_reason(state: AgentState) -> str:
    last = (state.get("messages") or [{}])[-1]
    return "prepare" if last.get("role") == "assistant" and last.get("tool_calls") else END


def route_after_observe(state: AgentState) -> str:
    route = state.get("route") or "reason"
    if route == "end":
        return END
    return "prepare" if route == "guard" else route   # 409 重出卡：从读现状重新开始


def _utc_now() -> datetime:
    return datetime.now(UTC)


def build_graph(*, llm: LLM, settings: Settings, checkpointer, now_fn: Callable[[], datetime] = _utc_now,
                audit=None):
    catalog.load_all()  # 启动期完整性断言（fail-closed）
    tools = openai_tools()
    g = StateGraph(AgentState)
    g.add_node("reason", make_reason_node(llm, tools, settings, audit))
    g.add_node("prepare", make_prepare_node(settings, now_fn))
    g.add_node("guard", make_guard_node(settings, now_fn))
    g.add_node("act", make_act_node(settings, now_fn, audit))
    g.add_node("reauth", make_reauth_node())
    g.add_node("observe", make_observe_node(settings, audit))
    g.add_edge(START, "reason")
    g.add_conditional_edges("reason", route_after_reason, {"prepare": "prepare", END: END})
    g.add_edge("prepare", "guard")
    g.add_edge("guard", "act")
    g.add_conditional_edges("act", route_after_act, {"act": "act", "reauth": "reauth", "observe": "observe"})
    g.add_edge("reauth", "act")
    g.add_conditional_edges("observe", route_after_observe, {"reason": "reason", "prepare": "prepare", END: END})
    return g.compile(checkpointer=checkpointer)
