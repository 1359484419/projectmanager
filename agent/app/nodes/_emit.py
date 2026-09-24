"""向 SSE 流发自定义事件（LangGraph custom stream）；不在图内运行时（单测直接调节点）静默忽略。"""
from typing import Any

from langgraph.config import get_stream_writer

from app.schemas import to_wire


def emit(event: dict[str, Any]) -> None:
    """event 为内部 snake_case 字典（或已 dump 的模型），此处经 to_wire 转成 camelCase 后写入流。"""
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return
    writer(to_wire(event))
