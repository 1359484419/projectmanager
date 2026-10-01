"""文档与 MCP 实现同步（评审 2026-09-25 §六：SKILL.md 与实际工具/命令不一致）。

skill/SKILL.md 的工具表必须与 app/mcp/tools.py::mcp_profile() 逐名一致；README / CLAUDE.md 的 MCP 段落不得再引用
已下线的 Java SDK 服务（McpConfig / McpTools）或不存在的 `claude skill add` 命令。
"""
import json
import re
from pathlib import Path

from app.mcp.prompts import DONE_TODAY_RULE, daily_report, weekly_report
from app.mcp.tools import mcp_profile

ROOT = Path(__file__).resolve().parents[2]
SKILL = (ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
CLAUDE = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
DEPLOY = (ROOT / "deploy" / "README.md").read_text(encoding="utf-8")

# 接入命令：优先 https://<域名>/mcp；无域名时才 http://<host>:8080/mcp（两种形式都认）
MCP_ADD = re.compile(r'claude mcp add --transport http pm (https://<[^>]+>|http://<[^>]+>:8080)/mcp '
                     r'--header "Authorization: Bearer pmt_')
MCP_ADD_HTTPS = 'claude mcp add --transport http pm https://<域名>/mcp --header "Authorization: Bearer pmt_'
MCP_CONFIG = json.loads((ROOT / "skill" / "mcp-config.example.json").read_text(encoding="utf-8"))
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
    assert MCP_ADD.search(SKILL) and MCP_ADD.search(README)


def test_connect_address_prefers_https_and_warns_about_plain_http():
    """审查 #6：示例优先 https://<域名>/mcp；无域名时才 http，且要说明 PAT 会明文传输。"""
    assert MCP_ADD_HTTPS in SKILL and MCP_ADD_HTTPS in README
    assert MCP_CONFIG["mcpServers"]["pm"]["url"] == "https://<域名>/mcp"
    for doc in (SKILL, README):
        assert "明文" in doc and "http://<host>:8080/mcp" in doc, "要说明无域名时才用 http 且 PAT 明文传输"


def test_skill_tool_count_matches_mcp_profile():
    """审查 #2：SKILL.md「共 N 个新工具」与表格行数必须等于 mcp_profile() 的新工具数（不含旧名别名）。"""
    new_tools = {d.name for d in mcp_profile()} - ALIASES
    m = re.search(r"共 (\d+) 个新工具", SKILL)
    assert m, "SKILL.md 缺少「共 N 个新工具」"
    assert int(m.group(1)) == len(new_tools)
    section = re.search(r"^## 可用工具\n(.*?)(?=^## )", SKILL, re.S | re.M).group(1)
    rows = re.findall(r"^\| `([a-z_]+)[^\n]*?\| ([^|]+?) \|", section, re.M)
    assert len([n for n, level in rows if "旧名" not in level]) == len(new_tools)
    assert len([n for n, level in rows if "旧名" in level]) == len(ALIASES)
    assert "14 个新工具" not in SKILL and "14 个新工具" not in README


def test_unauthenticated_remedy_removes_then_adds():
    """审查 #7：PAT 失效后 `claude mcp add` 同名会报已存在，必须先 remove 再 add。"""
    row = next(line for line in SKILL.splitlines() if line.startswith("| `UNAUTHENTICATED`"))
    assert "`claude mcp remove pm`" in row and "`claude mcp add" in row
    assert row.index("claude mcp remove pm") < row.index("claude mcp add")


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
    """审查 #3/#5：「今日完成」改用后端 statusChangedAt（COMPLETED/DONE 且状态变更在今天），不再用 updatedAt 判完成；
    取数用 scope=current + status_changed_since（待办 scope=backlog），不再全量 scope=all。"""
    daily = _skill_section("2. 日报")
    prompt = daily_report()
    assert "COMPLETED" in DONE_TODAY_RULE and "DONE" in DONE_TODAY_RULE and "statusChangedAt" in DONE_TODAY_RULE
    assert "updatedAt" not in DONE_TODAY_RULE and "doneAt" not in DONE_TODAY_RULE
    assert DONE_TODAY_RULE in daily
    assert DONE_TODAY_RULE in prompt
    for text in (daily, prompt):
        assert "status_changed_since" in text and "backlog" in text
        assert "updated_since" not in text                       # 旧取数写法 scope=all + updated_since 不得残留
        assert "全部已关闭" in text                              # 提到 all 只能是说明其代价（遍历全部已关闭迭代）
    # 旧的互相矛盾写法不得残留
    assert "或状态 COMPLETED/DONE" not in prompt
    assert "`doneAt` 是今天的 →" not in daily
    assert "updatedAt 是今天" not in daily and "updatedAt 是今天" not in prompt


def test_weekly_report_uses_status_changed_at():
    weekly = _skill_section("3. 周报")
    prompt = weekly_report()
    for text in (weekly, prompt):
        assert "statusChangedAt" in text and "status_changed_since" in text
        assert "updatedAt" not in text


def test_list_my_work_docs_mention_status_changed_fields():
    row = next(line for line in SKILL.splitlines() if line.startswith("| `list_my_work("))
    assert "status_changed_since" in row and "statusChangedAt" in row
    section = README.split("## MCP 集成", 1)[1].split("## 项目结构", 1)[0]
    assert "status_changed_since" in section
    assert "statusChangedAt" in CLAUDE and "日报取数用" not in CLAUDE


def test_skill_capability_boundary_describes_scope_all_truthfully():
    """审查 2026-09-25 MCP #6：scope=all 遍历全部已关闭迭代后，能力边界要如实描述。"""
    boundary = SKILL.split("## 能力边界", 1)[1].split("## ", 1)[0]
    assert "全部已关闭" in boundary or "所有已关闭" in boundary
    desc = next(d.description for d in mcp_profile() if d.name == "list_my_work")
    assert "已关闭" in desc
