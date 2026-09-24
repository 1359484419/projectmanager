"""schemas：camelCase 边界转换；approval：确认卡生成（before/after diff）。"""
from datetime import UTC, datetime, timedelta

import pytest
import respx
from pydantic import ValidationError

from app.harness import tool_guard as tg
from app.harness.approval import build_card
from app.harness.auth import reset_ctx, set_ctx
from app.schemas import Card, Decision, FieldChange, SseEvent, from_wire, to_wire
from app.tools import catalog
from tests._fx import CTX, mock_common

NOW = datetime(2026, 9, 24, 10, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _env():
    catalog.load_all()
    token = set_ctx(CTX)
    yield
    reset_ctx(token)


def test_to_wire_converts_snake_to_camel_recursively():
    card = Card(call_id="c1", tool="update_task_status", risk="L2", title="t", target="PM-12 x",
                changes=[FieldChange(field="status", label="状态", before="IN_PROGRESS", after="COMPLETED")],
                impact="i", editable=["status"], args={"task_key": "PM-12", "status": "COMPLETED"},
                expires_at=NOW, allowed_decisions=["approve", "edit", "reject"])
    w = to_wire(card)
    assert w["callId"] == "c1" and "call_id" not in w
    assert w["expiresAt"] == "2026-09-24T10:00:00Z"
    assert w["allowedDecisions"] == ["approve", "edit", "reject"]
    assert w["changes"][0] == {"field": "status", "label": "状态", "before": "IN_PROGRESS", "after": "COMPLETED"}
    assert w["args"] == {"taskKey": "PM-12", "status": "COMPLETED"}


def test_to_wire_drops_none_and_keeps_java_camel_data():
    ev = SseEvent(type="tool_result", call_id="c1", ok=True, summary="3 条",
                  data={"displayKey": "PM-12", "assigneeId": 8, "items": [{"seq_no": 1}]})
    w = to_wire(ev)
    assert w == {"type": "tool_result", "callId": "c1", "ok": True, "summary": "3 条",
                 "data": {"displayKey": "PM-12", "assigneeId": 8, "items": [{"seqNo": 1}]}}
    with pytest.raises(ValidationError):
        SseEvent(type="bogus")


def test_from_wire_converts_camel_to_snake():
    assert from_wire({"callId": "c1", "type": "edit", "args": {"newTitle": "x", "status": "DONE"}}) == \
        {"call_id": "c1", "type": "edit", "args": {"new_title": "x", "status": "DONE"}}
    d = Decision(**from_wire({"callId": "c1", "type": "approve"}))
    assert d.call_id == "c1" and d.args is None
    with pytest.raises(ValidationError):
        Decision(call_id="c1", type="maybe")


@respx.mock
async def test_build_card_l2_diff_and_allowed_decisions():
    mock_common()
    spec = tg.REGISTRY["update_task_status"]
    args = spec.params(task_key="PM-12", status="COMPLETED")
    card = await build_card(spec, args, "c1", CTX, NOW, ttl=600)
    assert card.call_id == "c1" and card.tool == "update_task_status" and card.risk == "L2"
    assert card.title == "修改任务状态 PM-12「登录页接入短信验证」"
    assert card.target == "PM-12 登录页接入短信验证"
    assert card.changes == [FieldChange(field="status", label="状态", before="IN_PROGRESS", after="COMPLETED")]
    assert card.editable == ["status"]
    assert card.allowed_decisions == ["approve", "edit", "reject"]
    assert card.expires_at == NOW + timedelta(seconds=600)
    assert card.args == {"task_key": "PM-12", "status": "COMPLETED"}
    assert card.impact


@respx.mock
async def test_build_card_update_task_only_lists_provided_fields():
    mock_common()
    spec = tg.REGISTRY["update_task"]
    args = spec.params(task_key="PM-12", title="新标题", clear_assignee=True)
    card = await build_card(spec, args, "c2", CTX, NOW, ttl=600)
    fields = {c.field: c for c in card.changes}
    assert set(fields) == {"title", "assignee"}
    assert fields["title"].before == "登录页接入短信验证" and fields["title"].after == "新标题"
    assert fields["assignee"].after is None            # clear_assignee → 置空
    assert "task_key" not in fields                      # 定位字段不算变更


@respx.mock
async def test_build_card_l3_has_no_edit_and_note_goes_to_impact():
    mock_common()
    spec = tg.REGISTRY["delete_task"]
    args = spec.params(task_key="PM-12")
    card = await build_card(spec, args, "c3", CTX, NOW, ttl=600, note="对象已被他人修改，请再次确认")
    assert card.risk == "L3" and card.allowed_decisions == ["approve", "reject"] and card.editable == []
    assert card.changes == []
    assert "PM-12" in card.target and "登录页接入短信验证" in card.target
    assert "已被他人修改" in card.impact and "不可恢复" in card.impact


def test_to_wire_card_editable_and_change_fields_match_args_key_style():
    """editable / changes[].field 是值不是键，但前端要用它们去 card.args 取值：同一张卡里必须同一风格（评审 #8）。"""
    spec = tg.REGISTRY["update_subtask"]
    card = Card(call_id="c1", tool="update_subtask", risk="L2", title="t", target="x",
                changes=[FieldChange(field="new_title", label="标题", before="a", after="b")],
                impact="i", editable=list(spec.editable),
                args={"task_key": "PM-12", "subtask_title": "a", "new_title": "b"},
                expires_at=NOW, allowed_decisions=["approve", "edit", "reject"])
    w = to_wire(card)
    assert w["editable"] == ["done", "newTitle"] and w["changes"][0]["field"] == "newTitle"
    assert w["args"] == {"taskKey": "PM-12", "subtaskTitle": "a", "newTitle": "b"}
    params_camel = {to_wire({f: 1}).popitem()[0] for f in spec.params.model_fields}
    assert set(w["editable"]) <= set(w["args"]) | params_camel
    # 嵌在 SseEvent 里的卡同样处理；前端回传的 edit args 经 from_wire 还原为工具 schema 字段名
    assert to_wire(SseEvent(type="confirm", call_id="c1", card=card))["card"]["editable"] == ["done", "newTitle"]
    assert from_wire({"newTitle": "c", "taskKey": "PM-12"}) == {"new_title": "c", "task_key": "PM-12"}


def test_result_card_model_wire_shape():
    from app.schemas import ResultCard
    rc = ResultCard(call_id="c9", tool="create_task", title="已创建 XX-0「x」", key="XX-0", summary="s", undoable=True,
                    path="/t/acme/backlog", data={"displayKey": "XX-0"})
    assert to_wire(rc) == {"callId": "c9", "tool": "create_task", "title": "已创建 XX-0「x」", "key": "XX-0",
                           "summary": "s", "undoable": True, "path": "/t/acme/backlog", "data": {"displayKey": "XX-0"}}
    assert "key" not in to_wire(ResultCard(call_id="c9", tool="x", title="t"))


@respx.mock
async def test_build_card_uses_effective_risk_for_escalated_create():
    mock_common()
    spec = tg.REGISTRY["create_task"]
    args = spec.params(type="TASK", title="x", assignee="张三")
    assert tg.effective_risk(spec, args, CTX) == "L2"
    card = await build_card(spec, args, "c1", CTX, NOW, ttl=600, risk="L2")
    assert card.risk == "L2" and card.target == "x"
    assert {c.field: c.after for c in card.changes} == {"assignee": "张三", "title": "x", "type": "TASK"}
    assert all(c.before is None for c in card.changes)
