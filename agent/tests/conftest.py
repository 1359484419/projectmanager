"""测试公共夹具：不依赖 agent/.env，用环境变量提供最小配置。"""
import os

import pytest

# 必填配置在导入 settings 之前给默认值（环境变量优先级高于 .env，测试不读真实凭证）
os.environ.setdefault("LLM_BASE_URL", "https://llm.invalid/v1")
os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("AGENT_DB_URL", "postgresql://pm:pm@localhost:5433/pm")
os.environ["PM_API_URL"] = "http://pm"  # respx 路由统一用 http://pm
# 测试不走开发机的代理（openai SDK 构造 httpx 客户端时会读 *_PROXY；SOCKS 代理还需要 socksio）
for _k in ("ALL_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "http_proxy", "https_proxy"):
    os.environ.pop(_k, None)


@pytest.fixture(autouse=True)
def _no_backoff_sleep(monkeypatch):
    """重试退避在测试里不真的睡。"""
    try:
        from app.harness import retry
    except ImportError:  # Task 1 阶段模块尚不存在
        return

    async def _noop(_attempt: int) -> None:
        return None

    monkeypatch.setattr(retry, "sleep_backoff", _noop)
