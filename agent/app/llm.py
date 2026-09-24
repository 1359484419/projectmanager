"""模型调用：openai.AsyncOpenAI 直连 OpenAI 兼容网关；temperature=0；剥离非标准 reasoning 字段；带重试。

- 默认流式（settings.llm_stream）：文本分片经 on_text 逐 token 下发（API 层接成 SSE text_delta），
  tool_calls 分片按 index 拼装；reasoning/reasoning_content 分片直接丢弃。
- 首 token 之前失败 → 按 with_llm_retry 重试；首 token 之后断流 → 不重试，抛 StreamInterrupted（保留已输出文本）。
- 图节点只依赖 LLM 协议，测试用 tests/fake_llm.FakeLLM 替换。
"""
import asyncio
from collections.abc import Callable
from typing import Any, Protocol

from openai import AsyncOpenAI

from app.harness.retry import with_llm_retry
from app.settings import Settings

# 网关可能返回的非标准思考字段：不进对话历史，不展示给用户
REASONING_KEYS: tuple[str, ...] = ("reasoning", "reasoning_content")

# /health 探活超时（秒）：探活只看连通性，不能拖慢健康检查


class LLM(Protocol):
    async def chat(self, messages: list[dict], tools: list[dict]) -> dict:
        """返回 assistant 消息 dict（content 或 tool_calls），附 "usage": {prompt_tokens, completion_tokens}。"""
        ...


class StreamInterrupted(Exception):
    """流式响应在已下发部分文本后断开：不能重试（会重复输出），由 API 层转成 STREAM_INTERRUPTED。"""

    def __init__(self, partial_text: str, cause: BaseException):
        super().__init__(f"stream interrupted after {len(partial_text)} chars: {cause!r}")
        self.partial_text = partial_text
        self.cause = cause


def _http_client(settings: Settings):
    """openai SDK 3.x 内置 httpx2；trust_env=False 时不读系统代理（开发机常有 SOCKS 代理且缺 socksio）。"""
    from openai import DefaultAsyncHttpxClient
    return DefaultAsyncHttpxClient(trust_env=settings.llm_trust_env, timeout=settings.run_timeout_seconds)


def strip_reasoning(msg: dict) -> dict:
    return {k: v for k, v in msg.items() if k not in REASONING_KEYS}


def _usage_dict(usage: Any) -> dict:
    return {"prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
            "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0)}


class OpenAILLM:
    def __init__(self, settings: Settings, *, on_text: Callable[[str], None] | None = None):
        self._client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                                   max_retries=0, timeout=settings.run_timeout_seconds,
                                   http_client=_http_client(settings))
        self._model = settings.llm_model
        self._max_retries = settings.llm_max_retries
        self._stream = settings.llm_stream
        self._ping_timeout = settings.llm_ping_timeout_seconds
        self._on_text = on_text

    @property
    def streams_text(self) -> bool:
        """True 表示 chat() 已逐 token 下发文本，reason 节点不必再整段 emit。"""
        return self._stream

    def _kwargs(self, messages: list[dict], tools: list[dict]) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"model": self._model, "messages": messages, "temperature": 0}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        return kwargs

    async def chat(self, messages: list[dict], tools: list[dict]) -> dict:
        if self._stream:
            return await self._chat_stream(messages, tools)
        return await self._chat_once(messages, tools)

    # ---------- 非流式 ----------

    async def _chat_once(self, messages: list[dict], tools: list[dict]) -> dict:
        async def _call():
            return await self._client.chat.completions.create(**self._kwargs(messages, tools))

        resp = await with_llm_retry(_call, max_retries=self._max_retries)
        choice = resp.choices[0]
        msg = strip_reasoning(choice.message.model_dump(exclude_none=True))
        msg["role"] = "assistant"
        msg.setdefault("content", None)
        if not msg.get("tool_calls"):
            msg.pop("tool_calls", None)
        msg["usage"] = _usage_dict(resp.usage)
        return msg

    # ---------- 流式 ----------

    async def _chat_stream(self, messages: list[dict], tools: list[dict]) -> dict:
        async def _open():
            return await self._client.chat.completions.create(
                **self._kwargs(messages, tools), stream=True, stream_options={"include_usage": True})

        # 只有"打开流"这一步走重试：一旦有任何分片下发出去，再失败就不能重来
        stream = await with_llm_retry(_open, max_retries=self._max_retries)
        text_parts: list[str] = []
        calls: dict[int, dict] = {}
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        try:
            async for chunk in stream:
                if getattr(chunk, "usage", None) is not None:
                    usage = _usage_dict(chunk.usage)
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    continue
                delta = getattr(choices[0], "delta", None)
                if delta is None:
                    continue
                piece = getattr(delta, "content", None)
                if piece:
                    text_parts.append(piece)
                    if self._on_text is not None:
                        self._on_text(piece)
                for tc in getattr(delta, "tool_calls", None) or []:
                    idx = int(getattr(tc, "index", 0) or 0)
                    slot = calls.setdefault(idx, {"id": None, "type": "function",
                                                  "function": {"name": "", "arguments": ""}})
                    if getattr(tc, "id", None):
                        slot["id"] = tc.id
                    fn = getattr(tc, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            slot["function"]["name"] += fn.name
                        if getattr(fn, "arguments", None):
                            slot["function"]["arguments"] += fn.arguments
        except asyncio.CancelledError:
            raise   # 超时/客户端断开的取消要原样传播，不能包成"断流"
        except Exception as exc:  # noqa: BLE001 —— 已经下发过分片，只能如实上报
            raise StreamInterrupted("".join(text_parts), exc) from exc

        msg: dict[str, Any] = {"role": "assistant", "content": "".join(text_parts) or None}
        if calls:
            msg["tool_calls"] = [calls[i] for i in sorted(calls)]
        msg["usage"] = usage
        return msg

    # ---------- 探活 ----------

    async def ping(self) -> None:
        """网关连通性：能拿到 /models（或网关明确回 404/405 不支持该端点）视为可达；连接/超时/5xx/401 视为不可达。"""
        from openai import APIStatusError
        try:
            await self._client.with_options(timeout=self._ping_timeout).models.list()
        except APIStatusError as exc:
            if exc.status_code in (404, 405):
                return
            raise


def make_llm(settings: Settings, *, on_text: Callable[[str], None] | None = None) -> LLM:
    return OpenAILLM(settings, on_text=on_text)
