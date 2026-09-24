"""图状态：messages 为 OpenAI 格式的 dict 列表（system/user/assistant/tool），只增不改。"""
import operator
from typing import Annotated, Any, TypedDict


class AgentState(TypedDict, total=False):
    messages: Annotated[list[dict], operator.add]   # OpenAI 格式：user/assistant/tool（system 由 reason 节点临时前置）
    round: int                                      # 本次运行已调用模型的次数
    decisions: dict[str, dict]                      # callId → {"type": approve|edit|reject, "args"?: dict, "message"?: str}
    cards: dict[str, dict]                          # callId → Card.model_dump()
    run_id: str
    tokens_used: int                                # prompt + completion 累计（上限判定用）
    prompt_tokens: int                              # 本次运行 prompt token 累计（done.usage 用）
    completion_tokens: int
    conflict_retries: dict[str, int]                # callId → 409 后重出卡次数
    last_call_sigs: list[str]                       # observe 用：f"{name}:{sorted args json}" 最近几条
    pending_call_ids: list[str]                     # guard 本轮处理、act 本轮允许执行的 callId（409 重出卡时只含冲突的）
    pending_results: dict[str, dict]                # act 逐调用累积的结果（phase=started/unauthorized/done + 结果字段）；observe 清空
    act_next: str                                   # act 的路由：act（还有写操作待执行）| reauth（后端 401）| observe（本轮全部完成）
    invalid_param_counts: dict[str, int]            # 工具名 → 本次运行 INVALID_PARAMS 次数（spec §7.5 自纠上限）
    error: dict[str, Any] | None                    # 触发上限/循环时的错误 {code, message}
    route: str                                      # observe 的路由结果：reason | guard | end
