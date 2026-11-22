"""starter.py 的解释器发现逻辑：老系统镜像（Jetson 3.6 / Bullseye 3.9）自举的兜底能力。

starter.py 是顶层脚本（非 server 包成员），pytest 从仓库根导入它——导入无副作用，
main 受 __main__ 守护。
"""

from __future__ import annotations

import subprocess
import sys

import starter


def test_python_version_reads_running_interpreter():
    version = starter._python_version(sys.executable)
    assert version is not None
    assert version >= (3, 9)


def test_python_version_rejects_garbage_interpreter():
    # 不存在的解释器 / 无输出的输出都应返回 None 而不是抛异常
    assert starter._python_version('definitely-not-a-python-xyz') is None


def test_find_python_returns_compliant_interpreter_or_none():
    found = starter._find_python()
    if found is not None:
        version = starter._python_version(found)
        assert version is not None and version >= starter.MIN_PYTHON


def test_min_python_matches_documented_floor():
    assert starter.MIN_PYTHON == (3, 11)


def test_starter_cli_parses_arguments():
    """--help 应正常退出（脚本可解析、无导入期副作用）"""
    result = subprocess.run(
        [sys.executable, str(starter.ROOT / 'starter.py'), '--help'],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0
    assert '--port' in result.stdout
