"""路径与环境配置：数据目录、前端产物目录、模型代理与限流，均可由环境变量或根目录 .env 覆盖。

.env 加载规则（极简实现，只依赖标准库）：
- 仅在环境变量「尚未设置」时生效（systemd Environment= / e2e 注入等优先）；
- 支持 KEY=VALUE、# 注释、可选 `export ` 前缀；未加引号的值会剥离行尾 `# 注释`；
- 引号成对时只剥离首尾引号，引号内的 # 保留；
- 在本模块导入时执行，因此对 starter.py 子进程与直接 uvicorn 两种启动方式一致生效。

DEEPSEEK_API_KEY 的占位符（模板里的示例值）视为未配置，避免 health 假阳性。
DEEPSEEK_BASE_URL 必须是合法 http(s) 地址，否则回退默认值，避免运行时 500。
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent

# .env.example 里未替换的示例值：这些都不是真 Key。判定用 is_placeholder_value 统一处理，
# 供 scripts/setup-board.sh 的校验保持同一套规则（见文件末尾的说明）。
_KEY_PLACEHOLDERS = frozenset({
    'your-deepseek-api-key',
    'your_api_key_here',
    'your-api-key',
    'sk-你的密钥',
    'changeme',
})

DEFAULT_BASE_URL = 'https://api.deepseek.com'

# 浏览器访问的同源代理前缀：路由、限流、上传限制三处共用
DEEPSEEK_PROXY_PREFIX = '/api/deepseek'


def is_placeholder_value(value: str) -> bool:
    """部署方直接复制模板、或写了明显示例值时返回 True。"""
    normalized = value.strip().strip('"').strip("'").strip().lower()
    if not normalized:
        return False
    return normalized in _KEY_PLACEHOLDERS or normalized.startswith(
        ('your-deepseek', 'your_', 'your-', 'sk-你的', 'changeme')
    )


def _clean_env_value(raw: str) -> str:
    value = raw.strip()
    # 成对引号：整体保留引号内的 #，最外层引号剥离
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    # 未加引号：剥离行尾注释（# 前为空白或位于行首）
    for index, char in enumerate(value):
        if char == '#' and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        key = key.strip()
        if key.startswith('export '):
            key = key[len('export ') :].strip()
        if key:
            os.environ.setdefault(key, _clean_env_value(value))


def _int_env(name: str, default: int) -> int:
    """非法或负值一律回退默认；0 表示关闭该项限制。"""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        parsed = int(raw.strip())
    except ValueError:
        return default
    return parsed if parsed >= 0 else default


_load_env_file(REPO_ROOT / '.env')

AMAP_KEY = os.environ.get('AMAP_KEY') or ''

# DeepSeek 模型 API：浏览器不再持有 Key，统一经 /api/deepseek/* 代理。
_raw_key = (os.environ.get('DEEPSEEK_API_KEY') or '').strip()
DEEPSEEK_KEY_PLACEHOLDER = is_placeholder_value(_raw_key)
DEEPSEEK_API_KEY = '' if DEEPSEEK_KEY_PLACEHOLDER else _raw_key

# 便于 /api/health 自检：env=已配置；placeholder=模板未替换；unset=没配
DEEPSEEK_KEY_SOURCE = (
    'env' if DEEPSEEK_API_KEY else ('placeholder' if DEEPSEEK_KEY_PLACEHOLDER else 'unset')
)

def resolve_rate_burst(rate_per_min: int, configured_burst: int) -> int:
    """开了速率但没设桶容量时，默认给一分钟的量：BURST=0 会让所有请求都拿不到令牌。"""
    return configured_burst or (rate_per_min if rate_per_min > 0 else 0)


# 模型代理按 IP 限流（server/rateLimit.py）。默认关闭，避免改变既有部署的行为；
# 公网或共享口令部署建议在 .env 里显式开启，防止服务端 Key 被盗刷。
DEEPSEEK_RATE_LIMIT_PER_MIN = _int_env('DEEPSEEK_RATE_LIMIT_PER_MIN', 0)
DEEPSEEK_DAILY_LIMIT = _int_env('DEEPSEEK_DAILY_LIMIT', 0)
DEEPSEEK_RATE_BURST = resolve_rate_burst(
    DEEPSEEK_RATE_LIMIT_PER_MIN, _int_env('DEEPSEEK_RATE_BURST', 0)
)


def _valid_base_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        if parts.scheme in ('http', 'https') and parts.netloc:
            return value.rstrip('/')
    except ValueError:
        pass
    return DEFAULT_BASE_URL


DEEPSEEK_BASE_URL = _valid_base_url(
    (os.environ.get('DEEPSEEK_BASE_URL') or '').strip() or DEFAULT_BASE_URL
)

DATA_DIR = Path(os.environ.get('DATA_DIR') or REPO_ROOT / 'data')
DIST_DIR = Path(os.environ.get('DIST_DIR') or REPO_ROOT / 'dist')
