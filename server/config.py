"""路径与环境配置：数据目录、前端产物目录，均可用环境变量或根目录 .env 覆盖。

.env 加载规则（极简实现，只依赖标准库）：
- 仅在环境变量「尚未设置」时生效（systemd Environment= / e2e 注入等优先）；
- 支持 KEY=VALUE 与 # 注释，值可带成对引号；
- 在本模块导入时执行，因此对 starter.py 子进程与直接 uvicorn 两种启动方式一致生效。
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_env_file(REPO_ROOT / '.env')

AMAP_KEY = os.environ.get('AMAP_KEY') or ''

# DeepSeek 模型 API：浏览器不再持有 Key，统一经 /api/deepseek/* 代理。
# 上游地址可覆盖（自建兼容网关 / 测试 mock），默认官方 Anthropic 兼容端点。
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY') or ''
DEEPSEEK_BASE_URL = (os.environ.get('DEEPSEEK_BASE_URL') or 'https://api.deepseek.com').rstrip('/')

DATA_DIR = Path(os.environ.get('DATA_DIR') or REPO_ROOT / 'data')
DIST_DIR = Path(os.environ.get('DIST_DIR') or REPO_ROOT / 'dist')
