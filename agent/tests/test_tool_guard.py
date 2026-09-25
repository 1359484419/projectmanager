import pytest
from pydantic import BaseModel
from app.harness import tool_guard as tg
from app.harness.auth import RequestCtx

class P(BaseModel):
    task_key: str

@pytest.fixture(autouse=True)
def clean_registry():
    tg.REGISTRY.clear()
    yield
    tg.REGISTRY.clear()

def test_register_and_openai_schema():
    @tg.pm_tool(name="get_task", risk="L0", description="查任务", params=P)
    async def get_task(p: P): return {}
    assert tg.REGISTRY["get_task"].risk == "L0"
    tools = tg.openai_tools()
    assert tools[0]["function"]["name"] == "get_task"
    assert tools[0]["function"]["parameters"]["required"] == ["task_key"]
    assert "title" not in tools[0]["function"]["parameters"]

def test_bad_name_rejected():
    with pytest.raises(ValueError):
        @tg.pm_tool(name="tasks.get", risk="L0", description="x", params=P)
        async def f(p): ...

def test_bad_risk_rejected():
    with pytest.raises(ValueError):
        @tg.pm_tool(name="x", risk="L9", description="x", params=P)  # type: ignore[arg-type]
        async def f(p): ...

def test_duplicate_rejected():
    @tg.pm_tool(name="a", risk="L0", description="x", params=P)
    async def f1(p): ...
    with pytest.raises(ValueError):
        @tg.pm_tool(name="a", risk="L0", description="x", params=P)
        async def f2(p): ...

def test_registry_completeness_fail_closed():
    @tg.pm_tool(name="a", risk="L0", description="x", params=P)
    async def f1(p): ...
    with pytest.raises(RuntimeError):
        tg.assert_registry_complete({"a", "b"})   # b 缺
    with pytest.raises(RuntimeError):
        tg.assert_registry_complete(set())         # a 多
    tg.assert_registry_complete({"a"})

def test_escalate_raises_risk():
    ctx = RequestCtx(jwt="j", tenant="t", user_id=1, project_key="PM", page=None)
    @tg.pm_tool(name="create_task", risk="L1", description="x", params=P,
                escalate=lambda p, c: "L2" if p.task_key == "other" else "L1")
    async def f(p): ...
    spec = tg.REGISTRY["create_task"]
    assert tg.effective_risk(spec, P(task_key="mine"), ctx) == "L1"
    assert tg.effective_risk(spec, P(task_key="other"), ctx) == "L2"
    assert tg.needs_approval("L2") and tg.needs_approval("L3")
    assert not tg.needs_approval("L1")

def test_escalate_cannot_lower_risk():
    ctx = RequestCtx(jwt="j", tenant="t", user_id=1, project_key=None, page=None)
    @tg.pm_tool(name="delete_task", risk="L3", description="x", params=P,
                escalate=lambda p, c: "L0")
    async def f(p): ...
    assert tg.effective_risk(tg.REGISTRY["delete_task"], P(task_key="k"), ctx) == "L3"

def test_ctx_contextvar_roundtrip():
    from app.harness import auth
    with pytest.raises(RuntimeError):
        auth.current_ctx()
    ctx = RequestCtx(jwt="j", tenant="t", user_id=1, project_key=None, page=None)
    token = auth.set_ctx(ctx)
    assert auth.current_ctx() is ctx
    auth.reset_ctx(token)
    with pytest.raises(RuntimeError):
        auth.current_ctx()


def test_tool_schema_keeps_property_named_title():
    """回归：_strip_titles 只删 pydantic 元数据 title，不能把名为 title 的属性（任务标题）一起删掉。"""
    from pydantic import BaseModel, ConfigDict, Field

    class Item(BaseModel):
        model_config = ConfigDict(extra="forbid")
        title: str = Field(description="标题")

    class P(BaseModel):
        model_config = ConfigDict(extra="forbid")
        title: str = Field(description="标题")
        items: list[Item] = Field(default_factory=list)

    schema = tg._strip_titles(P.model_json_schema())
    assert schema["properties"]["title"] == {"description": "标题", "type": "string"}
    assert schema["$defs"]["Item"]["properties"]["title"] == {"description": "标题", "type": "string"}
    assert "title" not in schema and "title" not in schema["$defs"]["Item"]
