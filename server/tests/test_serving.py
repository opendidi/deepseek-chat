"""静态托管开关（SERVE_DIST）的端到端行为：子进程起 uvicorn 验证两种形态。

- 默认（生产形态）：托管 dist/，/ 返回前端页面；
- SERVE_DIST=0（开发形态）：纯 API，/ 返回 404 提示 JSON，/api/health 正常。

app.py 的挂载发生在导入时，TestClient 无法在同一进程切换形态，因此用子进程。
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
VENV_PYTHON = ROOT / '.venv' / 'Scripts' / ('python.exe' if os.name == 'nt' else 'python')
PYTHON = VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable)


def _free_port() -> int:
    probe = socket.socket()
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
    probe.close()
    return port


def _start_backend(env_extra: dict[str, str]) -> tuple[subprocess.Popen, str]:
    port = _free_port()
    data_dir = tempfile.mkdtemp(prefix='dsw-serving-')
    env = {**os.environ, 'DATA_DIR': data_dir, **env_extra}
    proc = subprocess.Popen(
        [str(PYTHON), '-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', str(port)],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f'http://127.0.0.1:{port}'
    for _ in range(60):
        try:
            with urllib.request.urlopen(f'{base}/api/health', timeout=1) as response:
                if response.status == 200:
                    return proc, base
        except OSError:
            pass
        time.sleep(0.25)
    proc.terminate()
    raise RuntimeError('uvicorn 未在超时内就绪')


def _get(base: str, path: str) -> tuple[int, dict | bytes]:
    try:
        with urllib.request.urlopen(f'{base}{path}', timeout=5) as response:
            body = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        body = error.read()
        status = error.code
    try:
        return status, json.loads(body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return status, body


def _stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_serve_dist_disabled_returns_hint():
    """SERVE_DIST=0：纯 API 形态，/ 返回 404 提示，/api/health 正常"""
    proc, base = _start_backend({'SERVE_DIST': '0'})
    try:
        status, data = _get(base, '/')
        assert status == 404
        assert isinstance(data, dict)
        assert '未托管前端' in data['detail']
        assert 'pnpm dev' in data['hint']['开发调试']
        status, data = _get(base, '/api/health')
        assert status == 200
        assert data['ok'] is True
    finally:
        _stop(proc)


def test_serve_dist_default_serves_frontend():
    """默认形态：dist 存在时 / 托管前端页面（CI 在 pytest 阶段可能没有 dist，跳过）"""
    if not (ROOT / 'dist' / 'index.html').is_file():
        pytest.skip('dist 未构建')
    proc, base = _start_backend({})
    try:
        status, body = _get(base, '/')
        assert status == 200
        assert isinstance(body, bytes)
        assert b'<div id="root">' in body
    finally:
        _stop(proc)
