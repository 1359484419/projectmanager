"""OpenAILLM 流式：逐 token 经 on_text 下发；tool_calls 分片拼装；reasoning 分片丢弃；usage 取末块；
首 token 前失败可重试、首 token 后失败不重试（StreamInterrupted）；llm_stream=False 走非流式。
"""
from types import SimpleNamespace

import httpx
import openai
import pytest

from app.llm import OpenAILLM, StreamInterrupted
from app.settings import get_settings


def chunk(*, content=None, reasoning=None, tool_calls=None, usage=None, finish=None):
    delta = SimpleNamespace(content=content, reasoning_content=reasoning, tool_calls=tool_calls, role="assistant")
    choice = SimpleNamespace(delta=delta, finish_reason=finish, index=0)
    return SimpleNamespace(choices=[choice] if (content is not None or reasoning is not None or tool_calls is not None
                                                or finish is not None) else [],
                           usage=usage)


def tc_delta(index: int, *, id=None, name=None, arguments=None):
    return SimpleNamespace(index=index, id=id, type="function",
                           function=SimpleNamespace(name=name, arguments=arguments))


class FakeStream:
    def __init__(self, chunks, *, fail_after: int | None = None):
        self._chunks = list(chunks)
        self._fail_after = fail_after

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._fail_after is not None and self._i == self._fail_after:
            raise openai.APIConnectionError(request=httpx.Request("POST", "https://llm.invalid/v1/chat/completions"))
        if self._i >= len(self._chunks):
            raise StopAsyncIteration
        c = self._chunks[self._i]
        self._i += 1
        return c


def make_llm(create_impl, *, stream: bool = True, on_text=None) -> OpenAILLM:
    settings = get_settings().model_copy(update={"llm_stream": stream})
    llm = OpenAILLM(settings, on_text=on_text)
    llm._client.chat.completions.create = create_impl   # type: ignore[method-assign]
    return llm


async def test_stream_text_and_tool_calls_assembled():
    seen_kwargs = {}
    texts: list[str] = []

    async def create(**kwargs):
        seen_kwargs.update(kwargs)
        return FakeStream([
            chunk(reasoning="让我想想"),
            chunk(content="好的，"),
            chunk(content="我来查"),
            chunk(tool_calls=[tc_delta(0, id="c1", name="list_projects", arguments="")]),
            chunk(tool_calls=[tc_delta(0, arguments="{}")]),
            chunk(tool_calls=[tc_delta(1, id="c2", name="update_task_status", arguments='{"task_key"')]),
            chunk(tool_calls=[tc_delta(1, arguments=': "PM-12", "status": "DONE"}')]),
            chunk(finish="tool_calls"),
            chunk(usage=SimpleNamespace(prompt_tokens=50, completion_tokens=7)),
        ])

    llm = make_llm(create, on_text=texts.append)
    msg = await llm.chat([{"role": "user", "content": "x"}], [{"type": "function", "function": {"name": "f"}}])
    assert seen_kwargs["stream"] is True and seen_kwargs["stream_options"] == {"include_usage": True}
    assert seen_kwargs["temperature"] == 0 and seen_kwargs["tool_choice"] == "auto"
    assert texts == ["好的，", "我来查"]
    assert msg["role"] == "assistant" and msg["content"] == "好的，我来查"
    assert "reasoning" not in msg and "reasoning_content" not in msg
    assert msg["tool_calls"] == [
        {"id": "c1", "type": "function", "function": {"name": "list_projects", "arguments": "{}"}},
        {"id": "c2", "type": "function", "function": {"name": "update_task_status",
                                                      "arguments": '{"task_key": "PM-12", "status": "DONE"}'}}]
    assert msg["usage"] == {"prompt_tokens": 50, "completion_tokens": 7}
    assert llm.streams_text is True


async def test_stream_plain_text_without_tools_has_no_tool_calls_key():
    async def create(**kwargs):
        return FakeStream([chunk(content="你好"), chunk(finish="stop")])

    llm = make_llm(create)
    msg = await llm.chat([{"role": "user", "content": "x"}], [])
    assert msg == {"role": "assistant", "content": "你好", "usage": {"prompt_tokens": 0, "completion_tokens": 0}}


async def test_failure_before_first_token_is_retried():
    calls = {"n": 0}

    async def create(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise openai.APIConnectionError(request=httpx.Request("POST", "https://llm.invalid"))
        return FakeStream([chunk(content="ok"), chunk(finish="stop")])

    llm = make_llm(create)
    msg = await llm.chat([{"role": "user", "content": "x"}], [])
    assert msg["content"] == "ok" and calls["n"] == 2


async def test_failure_after_first_token_is_not_retried():
    calls = {"n": 0}
    texts: list[str] = []

    async def create(**kwargs):
        calls["n"] += 1
        return FakeStream([chunk(content="前半"), chunk(content="句")], fail_after=1)

    llm = make_llm(create, on_text=texts.append)
    with pytest.raises(StreamInterrupted) as ei:
        await llm.chat([{"role": "user", "content": "x"}], [])
    assert calls["n"] == 1 and texts == ["前半"] and ei.value.partial_text == "前半"


async def test_non_stream_mode_keeps_legacy_path():
    seen = {}

    async def create(**kwargs):
        seen.update(kwargs)
        message = SimpleNamespace(model_dump=lambda exclude_none: {"role": "assistant", "content": "hi",
                                                                   "reasoning": "x", "tool_calls": None})
        return SimpleNamespace(choices=[SimpleNamespace(message=message)],
                               usage=SimpleNamespace(prompt_tokens=3, completion_tokens=1))

    llm = make_llm(create, stream=False)
    msg = await llm.chat([{"role": "user", "content": "x"}], [])
    assert "stream" not in seen and llm.streams_text is False
    assert msg == {"role": "assistant", "content": "hi", "usage": {"prompt_tokens": 3, "completion_tokens": 1}}


async def test_reason_node_skips_text_delta_when_llm_streams_itself():
    """流式模型自己已逐 token 发 text_delta，reason 不再整段重发（否则前端会看到两遍）。"""
    from langgraph.checkpoint.memory import InMemorySaver

    from app.graph import build_graph
    from app.harness.auth import reset_ctx, set_ctx
    from tests._fx import CTX
    from tests.fake_llm import FakeLLM, text

    class StreamingFake(FakeLLM):
        streams_text = True

    token = set_ctx(CTX)
    try:
        g = build_graph(llm=StreamingFake([text("你好")]), settings=get_settings(), checkpointer=InMemorySaver())
        customs = []
        async for mode, chunk_ in g.astream({"messages": [{"role": "user", "content": "hi"}], "round": 0,
                                             "tokens_used": 0, "run_id": "r"},
                                            {"configurable": {"thread_id": "s1"}}, stream_mode=["updates", "custom"]):
            if mode == "custom":
                customs.append(chunk_)
        assert customs == []
    finally:
        reset_ctx(token)
