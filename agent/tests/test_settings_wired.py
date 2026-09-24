"""spec §7.2：每个 settings 字段都有消费点（防「声明未接线」）。新增字段却没人读时这里失败（R2 low #11）。"""
import pathlib
import re

from app.settings import Settings

APP = pathlib.Path(__file__).resolve().parents[1] / "app"
# 确需豁免的字段写在这里并说明理由（当前没有）
EXEMPT: dict[str, str] = {}


def test_every_settings_field_is_consumed_somewhere_in_app():
    sources = [p.read_text() for p in APP.rglob("*.py") if p.name != "settings.py"]
    missing = [name for name in Settings.model_fields
               if name not in EXEMPT and not any(re.search(rf"\b{name}\b", s) for s in sources)]
    assert missing == [], f"settings 字段声明了但没人读：{missing}"


def test_exempt_list_only_names_real_fields():
    assert set(EXEMPT) <= set(Settings.model_fields)
