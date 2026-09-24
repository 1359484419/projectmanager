"""兜底映射：每个工具都有手动入口；错误码都有文案。"""
from app.harness.fallback import ERROR_TEXT, error_event, manual_path
from app.tools import catalog
from tests._fx import CTX

ROUTES = {"dashboard", "backlog", "board", "sprints", "planning", "reports", "roadmap", "records", "admin", "settings"}


def test_every_tool_has_manual_path_under_tenant_routes():
    for name in catalog.EXPECTED_TOOLS:
        label, path = manual_path(name, CTX)
        assert label and path.startswith("/t/acme/"), name
        assert path.split("/")[3] in ROUTES, (name, path)


def test_specific_mappings():
    assert manual_path("update_task_status", CTX) == ("去看板手动操作", "/t/acme/board")
    assert manual_path("update_task", CTX) == ("去看板手动操作", "/t/acme/board")
    assert manual_path("create_task", CTX)[1] == "/t/acme/backlog"
    assert manual_path("update_epic", CTX)[1] == "/t/acme/roadmap"
    assert manual_path("create_record", CTX)[1] == "/t/acme/records"
    assert manual_path("remove_member", CTX)[1] == "/t/acme/admin"
    assert manual_path("start_sprint", CTX)[1] == "/t/acme/planning"
    # 未知工具（不应发生）也不抛 KeyError，退回仪表盘
    assert manual_path("no_such_tool", CTX)[1] == "/t/acme/dashboard"


def test_error_text_covers_all_codes_and_event_shape():
    for code in ("LLM_UNAVAILABLE", "STREAM_INTERRUPTED", "TOKEN_EXPIRED", "MAX_ROUNDS", "MAX_TOKENS",
                 "REPEATED_CALLS", "ASSISTANT_TIMEOUT", "CARD_EXPIRED"):
        assert ERROR_TEXT[code]
    ev = error_event("MAX_ROUNDS", CTX, tool="update_task")
    assert ev.type == "error" and ev.code == "MAX_ROUNDS" and ev.message == ERROR_TEXT["MAX_ROUNDS"]
    assert ev.fallback is not None and ev.fallback.path == "/t/acme/board"
    ev2 = error_event("BOGUS", CTX)
    assert ev2.message and ev2.fallback.path == "/t/acme/dashboard"
