"""唯一配置真相源：所有上限/凭证/地址只从这里读，模块内不写第二份常量。"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# agent/.env（gitignored）；用绝对路径，避免 uvicorn 从其他目录启动时读不到
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    # 大模型网关（OpenAI 兼容）
    llm_base_url: str
    llm_api_key: str
    llm_model: str = "DeepSeek-V4.1-Flash"  # 模型 ID 大小写敏感
    llm_stream: bool = True                 # 逐 token 流式（网关不支持时关掉，退回整段返回）
    llm_trust_env: bool = False             # 模型网关连接是否走系统代理环境变量（开发机常有 SOCKS 代理且缺 socksio，默认直连）

    # Java 后端
    pm_api_url: str = "http://127.0.0.1:8080"

    # 智能体自身的 PG（checkpoint + 审计），独立 schema
    agent_db_url: str
    agent_db_schema: str = "agent"

    # 单次运行上限
    max_tool_rounds: int = 15
    max_tokens_per_run: int = 60000
    run_timeout_seconds: int = 90
    card_ttl_seconds: int = 600

    # 重试
    llm_max_retries: int = 3
    get_max_retries: int = 2
    # 入参校验失败回给模型自纠的次数上限（按工具计，spec §7.5）；超过 → error{INVALID_PARAMS}
    max_invalid_param_retries: int = 2
    # 同工具同参数连续重复次数 → 停止（spec §7.6）；last_call_sigs 只保留最近多少条签名
    repeat_call_limit: int = 3
    call_sig_window: int = 12

    # 会话保留：最新 checkpoint 早于 N 天的线程连同审计行一起删；lifespan 每 retention_check_seconds 清理一次
    thread_retention_days: int = 7
    retention_check_seconds: int = 3600

    # 请求体上限：消息文本字符数、一次 resume 的决策条数
    max_message_chars: int = 4000
    max_decisions_per_resume: int = 20

    # SSE 保活注释行间隔；/health 对模型网关的探活超时
    sse_ping_seconds: int = 15
    llm_ping_timeout_seconds: float = 5.0

    # /health 探活结果缓存秒数
    health_cache_seconds: int = 60

    # PG 连接池（checkpointer 与审计各一个池）
    agent_db_pool_size: int = 4

    # reason 节点消息裁剪：原样保留最近 N 轮，更早只留含展示号的工具结果摘要（每条工具结果最多列 M 条、非 JSON 内容截断到 K 字）
    context_keep_rounds: int = 12
    context_summary_max_items: int = 30
    context_summary_max_chars: int = 200

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
