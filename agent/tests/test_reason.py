"""reason 节点：假模型驱动；剥离 reasoning；消息裁剪保留展示号摘要。"""
import pytest

from app.harness.auth import reset_ctx, set_ctx
from app.nodes.reason import make_reason_node, trim_messages
from app.settings import get_settings
from tests._fx import CTX
from tests.fake_llm import FakeLLM, calls, text, tool_call


@pytest.fixture(autouse=True)
def _ctx():
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


def _state(messages, round_=0, tokens=0):
    return {"messages": messages, "round": round_, "tokens_used": tokens, "decisions": {}, "cards": {},
            "run_id": "r1", "conflict_retries": {}, "last_call_sigs": []}


async def test_reason_returns_assistant_and_counts_round_and_tokens():
    llm = FakeLLM([calls(tool_call("list_projects", {}, "c1"), reasoning="想一下")])
    node = make_reason_node(llm, tools=[{"type": "function", "function": {"name": "list_projects"}}],
                            settings=get_settings())
    out = await node(_state([{"role": "user", "content": "我有哪些项目"}], round_=2, tokens=50))
    assert out["round"] == 3
    assert out["tokens_used"] == 50 + 110
    msg = out["messages"][0]
    assert msg["role"] == "assistant" and msg["tool_calls"][0]["function"]["name"] == "list_projects"
    assert "reasoning" not in msg and "usage" not in msg
    assert llm.calls[0]["tools"][0]["function"]["name"] == "list_projects"


async def test_reason_prepends_system_prompt_with_context():
    llm = FakeLLM([text("你好", reasoning="x")])
    node = make_reason_node(llm, tools=[], settings=get_settings())
    out = await node(_state([{"role": "user", "content": "hi"}]))
    assert out["messages"] == [{"role": "assistant", "content": "你好"}]
    sent = llm.calls[0]["messages"]
    assert sent[0]["role"] == "system"
    assert "PM" in sent[0]["content"] and "XX-0" in sent[0]["content"] and "COMPLETED" in sent[0]["content"]
    assert sent[-1] == {"role": "user", "content": "hi"}


def _round(i: int, with_key: bool):
    tc = tool_call("get_task", {"task_key": f"PM-{i}"}, f"c{i}")
    content = f'{{"displayKey": "PM-{i}", "title": "任务{i}"}}' if with_key else "无关内容 " + "x" * 50
    return [{"role": "user", "content": f"第 {i} 问"},
            calls(tc),
            {"role": "tool", "tool_call_id": f"c{i}", "content": content},
            text(f"回答 {i}")]


def test_trim_keeps_recent_rounds_and_display_key_summaries():
    msgs = []
    for i in range(1, 21):
        msgs += _round(i, with_key=(i in (1, 2)))
    kept = trim_messages(msgs, keep_rounds=12)
    # 最近 12 轮原样保留（每轮 4 条）
    assert kept[-48:] == msgs[-48:]
    # 更早的轮次只剩摘要，且摘要里保留展示号
    older = kept[:-48]
    assert all(m["role"] != "tool" for m in older)
    joined = "\n".join(m["content"] for m in older)
    assert "PM-1" in joined and "PM-2" in joined and "任务1" in joined
    assert "无关内容" not in joined
    # 不裁剪的情况原样返回
    assert trim_messages(msgs[:8], keep_rounds=12) == msgs[:8]


async def test_reason_uses_trimmed_history_but_state_unchanged():
    msgs = []
    for i in range(1, 16):
        msgs += _round(i, with_key=(i == 1))
    llm = FakeLLM([text("好")])
    node = make_reason_node(llm, tools=[], settings=get_settings())
    await node(_state(msgs))
    sent = llm.calls[0]["messages"]
    assert len(sent) < len(msgs) + 1
    assert sent[0]["role"] == "system" and "PM-1" not in sent[0]["content"]       # 摘要不进 system 提示
    assert any("PM-1" in (m.get("content") or "") for m in sent if m["role"] == "user")
