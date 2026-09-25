"""文档与 MCP 实现同步（评审 2026-09-25 §六：SKILL.md 与实际工具/命令不一致）。

skill/SKILL.md 的工具表必须与 app/mcp/tools.py::mcp_profile() 逐名一致；README / CLAUDE.md 的 MCP 段落不得再引用
已下线的 Java SDK 服务（McpConfig / McpTools）或不存在的 `claude skill add` 命令。
"""
import re
from pathlib import Path

from app.mcp.prompts import DONE_TODAY_RULE, daily_report
from app.mcp.tools import mcp_profile

ROOT = Path(__file__).resolve().parents[2]
SKILL = (ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
CLAUDE = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
DEPLOY = (ROOT / "deploy" / "README.md").read_text(encoding="utf-8")

MCP_ADD = 'claude mcp add --transport http pm http://<host>:8080/mcp --header "Authorization: Bearer pmt_'
ALIASES = {"list_sprints", "list_epics", "list_my_tasks"}


def _skill_tool_table() -> set[str]:
    """「## 可用工具」到下一个 `## ` 之间，表格行首反引号里的工具名。"""
    m = re.search(r"^## 可用工具\n(.*?)(?=^## )", SKILL, re.S | re.M)
    assert m, "SKILL.md 缺少「## 可用工具」小节"
    return set(re.findall(r"^\| `([a-z_]+)", m.group(1), re.M))


def test_skill_tool_table_matches_mcp_profile():
    expected = {d.name for d in mcp_profile()}
    assert _skill_tool_table() == expected


def test_readme_lists_core_tools_and_skill_marks_aliases():
    core = {d.name for d in mcp_profile()} - ALIASES
    section = README.split("## MCP 集成", 1)[1].split("## 项目结构", 1)[0]
    assert core <= set(re.findall(r"`([a-z_]+)`", section)), core - set(re.findall(r"`([a-z_]+)`", section))
    for alias in ALIASES:
        assert re.search(rf"^\| `{alias}\b[^\n]*旧名", SKILL, re.M), f"{alias} 在 SKILL.md 工具表里必须标注为旧名"


def test_skill_flows_and_safety_rules():
    assert "list_my_work" in SKILL and "done_since" in SKILL and "get_task" in SKILL
    assert "confirm" in SKILL and "dry_run" in SKILL
    assert "正整数" not in SKILL
    assert "claude skill add" not in SKILL and "claude skill add" not in README


def test_connect_command_matches_claude_code_cli():
    assert MCP_ADD in SKILL
    assert MCP_ADD in README


def test_claude_md_describes_proxy_not_java_sdk_server():
    for stale in ("McpConfig", "McpTools", "MCP Java SDK"):
        assert stale not in CLAUDE and stale not in README, stale
    assert "McpProxyController" in CLAUDE and "agent/app/mcp/" in CLAUDE


def test_deploy_readme_mentions_mcp_dependency_on_agent_and_backup():
    assert "/mcp" in DEPLOY and "pm-db-backup.timer" in DEPLOY and "pg_restore" in DEPLOY


def _skill_section(title: str) -> str:
    m = re.search(rf"^### {re.escape(title)}\n(.*?)(?=^### |^## )", SKILL, re.S | re.M)
    assert m, f"SKILL.md 缺少「### {title}」小节"
    return m.group(1)


def test_daily_report_done_today_rule_is_identical_in_skill_and_prompt():
    """审查 2026-09-25 MCP #5：COMPLETED 不写 doneAt，两处模板必须用同一条「今日完成」规则。"""
    daily = _skill_section("2. 日报")
    prompt = daily_report()
    assert "COMPLETED" in DONE_TODAY_RULE and "updatedAt" in DONE_TODAY_RULE and "doneAt" in DONE_TODAY_RULE
    assert DONE_TODAY_RULE in daily
    assert DONE_TODAY_RULE in prompt
    # 第 1 步要拉「今天变更过」的任务，否则 COMPLETED 的筛不到
    assert "updated_since" in daily and "updated_since" in prompt
    # 旧的互相矛盾写法不得残留
    assert "或状态 COMPLETED/DONE" not in prompt
    assert "`doneAt` 是今天的 →" not in daily


def test_skill_capability_boundary_describes_scope_all_truthfully():
    """审查 2026-09-25 MCP #6：scope=all 遍历全部已关闭迭代后，能力边界要如实描述。"""
    boundary = SKILL.split("## 能力边界", 1)[1].split("## ", 1)[0]
    assert "全部已关闭" in boundary or "所有已关闭" in boundary
    desc = next(d.description for d in mcp_profile() if d.name == "list_my_work")
    assert "已关闭" in desc
