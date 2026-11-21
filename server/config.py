"""路径配置：数据目录与前端产物目录，可用环境变量覆盖。

在模块导入时读取环境变量（uvicorn 每次启动都是新进程，e2e 通过 spawn 时的 env 注入）。
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.environ.get('DATA_DIR') or REPO_ROOT / 'data')
DIST_DIR = Path(os.environ.get('DIST_DIR') or REPO_ROOT / 'dist')
