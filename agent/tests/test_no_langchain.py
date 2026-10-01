"""守卫：只用 LangGraph 原生 API 手写 ReAct 图。

禁止：import langchain / langchain_core / langchain_openai；langgraph.prebuilt（create_react_agent / ToolNode）；
以及 importlib 动态导入或 create_agent / create_react_agent 之类的预制智能体。app/ 与 tests/ 一起扫。
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMPORT_RE = re.compile(r"^\s*(from|import)\s+(langchain|langgraph\.prebuilt)"
                       r"|^\s*from\s+langgraph\s+import\s+.*\bprebuilt\b", re.M)
DYNAMIC_RE = re.compile(r"import_module\(\s*['\"](langchain|langgraph\.prebuilt)|create_react_agent|create_agent\b|\bToolNode\b")


def _sources():
    for d in ("app", "tests"):
        for p in (ROOT / d).rglob("*.py"):
            if p.name != "test_no_langchain.py":
                yield p


def test_no_langchain_or_prebuilt_imports():
    bad = [str(p) for p in _sources() if IMPORT_RE.search(p.read_text(encoding="utf-8"))]
    assert bad == [], f"禁止 import langchain / langgraph.prebuilt：{bad}"


def test_no_dynamic_or_prebuilt_agents():
    bad = [str(p) for p in _sources() if DYNAMIC_RE.search(p.read_text(encoding="utf-8"))]
    assert bad == [], f"禁止动态导入 langchain 或使用预制智能体：{bad}"


def test_guard_catches_prebuilt_import(tmp_path):
    """守卫自身有效：langgraph.prebuilt 与 importlib 形式都要被正则命中。"""
    assert IMPORT_RE.search("from langgraph.prebuilt import create_react_agent")
    assert IMPORT_RE.search("import langchain_core.messages")
    assert DYNAMIC_RE.search('importlib.import_module("langchain_openai")')
    assert not IMPORT_RE.search("from langgraph.graph import StateGraph")


def test_guard_catches_from_langgraph_import_prebuilt():
    """`from langgraph import prebuilt` 再 prebuilt.xxx 的写法也要被拦（R2 low #4）。"""
    assert IMPORT_RE.search("from langgraph import prebuilt")
    assert IMPORT_RE.search("from langgraph import graph, prebuilt")
    assert not IMPORT_RE.search("from langgraph import graph")
