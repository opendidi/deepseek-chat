"""模型代理的两道防护与配置解析测试：限流、上传体积、.env 归一化。

全部走 TestClient + monkeypatch，不访问网络。限流状态是模块级字典，每个用例前清空。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='dsw-guards-')

from fastapi.testclient import TestClient  # noqa: E402

from server import config, rateLimit  # noqa: E402
from server.app import app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _clear_rate_state(monkeypatch):
    rateLimit._buckets.clear()
    rateLimit._daily.clear()
    # 限流测试只关心 429/放行，不关心模型结果：把 Key 置空让请求在 require_key 处
    # 直接返回 400，避免真的去打上游（本机 .env 里可能配了真实 Key）。
    import server.deepseek as deepseek

    monkeypatch.setattr(deepseek, 'DEEPSEEK_API_KEY', '')
    yield
    rateLimit._buckets.clear()
    rateLimit._daily.clear()


# --- 限流 ---

def test_rate_limit_disabled_by_default(client):
    """三个配置全为 0 时不计数、不拦截。"""
    assert rateLimit.RATE_PER_MIN == 0
    assert rateLimit.DAILY_LIMIT == 0
    # 缺 Key 会返回 400，但不是限流的 429
    assert client.get('/api/deepseek/models').status_code != 429


def test_rate_limit_rejects_burst(monkeypatch, client):
    monkeypatch.setattr(rateLimit, 'RATE_PER_MIN', 60)
    monkeypatch.setattr(rateLimit, 'BURST', 1)
    monkeypatch.setattr(rateLimit, 'DAILY_LIMIT', 0)
    # 第一次放行（缺 Key → 400），第二次被令牌桶拒绝（429）
    assert client.get('/api/deepseek/models').status_code == 400
    response = client.get('/api/deepseek/models')
    assert response.status_code == 429
    assert response.json()['code'] == 'RATE_LIMITED'


def test_daily_quota_not_consumed_by_rate_limited_request(monkeypatch, client):
    """被限流的请求不能消耗日配额（修复前的 bug）。"""
    monkeypatch.setattr(rateLimit, 'RATE_PER_MIN', 60)
    monkeypatch.setattr(rateLimit, 'BURST', 1)
    monkeypatch.setattr(rateLimit, 'DAILY_LIMIT', 2)
    assert client.get('/api/deepseek/models').status_code == 400
    assert client.get('/api/deepseek/models').status_code == 429  # 限流
    # 日计数仍应为 1（只有放行的那次）
    assert list(rateLimit._daily.values())[0][1] == 1


def test_daily_quota_blocks_after_limit(monkeypatch, client):
    """只用日配额（关掉令牌桶）时，超过上限返回 QUOTA_EXCEEDED。"""
    monkeypatch.setattr(rateLimit, 'RATE_PER_MIN', 0)
    monkeypatch.setattr(rateLimit, 'BURST', 0)
    monkeypatch.setattr(rateLimit, 'DAILY_LIMIT', 2)
    assert client.get('/api/deepseek/models').status_code == 400
    assert client.get('/api/deepseek/models').status_code == 400
    response = client.get('/api/deepseek/models')
    assert response.status_code == 429
    assert response.json()['code'] == 'QUOTA_EXCEEDED'
    assert list(rateLimit._daily.values())[0][1] == 2


def test_rate_limit_only_applies_to_deepseek_prefix(monkeypatch, client):
    monkeypatch.setattr(rateLimit, 'RATE_PER_MIN', 60)
    monkeypatch.setattr(rateLimit, 'BURST', 1)
    monkeypatch.setattr(rateLimit, 'DAILY_LIMIT', 0)
    # 非代理路径不受限流影响
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/health').status_code == 200


def test_trusted_proxy_uses_forwarded_for(monkeypatch, client):
    # TestClient 的 peer 是 "testclient"，生产环境是 127.0.0.1；把它加入可信集合以验证 XFF 逻辑
    monkeypatch.setattr(
        rateLimit, 'TRUSTED_PROXY_PEERS', frozenset({'127.0.0.1', '::1', 'testclient'})
    )
    monkeypatch.setattr(rateLimit, 'RATE_PER_MIN', 60)
    monkeypatch.setattr(rateLimit, 'BURST', 1)
    monkeypatch.setattr(rateLimit, 'DAILY_LIMIT', 0)
    headers = {'x-forwarded-for': '1.2.3.4, 10.0.0.1'}
    assert client.get('/api/deepseek/models', headers=headers).status_code == 400
    # 同一 IP 第二次被拒
    assert client.get('/api/deepseek/models', headers=headers).status_code == 429
    # 另一 IP 仍有自己的桶
    assert client.get(
        '/api/deepseek/models', headers={'x-forwarded-for': '5.6.7.8'}
    ).status_code == 400


def test_untrusted_peer_ignores_forwarded_for(monkeypatch):
    """远端直连时 XFF 可伪造，必须用真实连接地址。"""
    assert rateLimit._client_ip({'client': ('1.2.3.4', 5000)}) == '1.2.3.4'
    assert rateLimit._client_ip({'client': ('testclient', 50000)}) == 'testclient'


# --- 上传体积 ---

def test_upload_limit_paths_are_scoped():
    from server.uploadLimit import ASR_LIMIT, FILE_LIMIT, limit_for_path

    assert limit_for_path('/api/deepseek/files') == FILE_LIMIT
    assert limit_for_path('/api/deepseek/tools/asr') == ASR_LIMIT
    assert limit_for_path('/api/sessions/x') is None


def test_upload_limit_rejects_oversized_content_length(client):
    """Content-Length 预检：超大 ASR 请求在解析 multipart 前返回 413。"""
    from server.uploadLimit import ASR_LIMIT

    big = b'x' * (ASR_LIMIT + 1)
    response = client.post(
        '/api/deepseek/tools/asr', files={'file': ('a.wav', big, 'audio/wav')}
    )
    assert response.status_code == 413
    assert response.json()['code'] == 'UPLOAD_TOO_LARGE'


# --- .env 解析与占位符 ---

def _write_env(tmp_path: Path, text: str) -> Path:
    env_file = tmp_path / '.env'
    env_file.write_text(text, encoding='utf-8')
    return env_file


def test_clean_env_value_strips_inline_comment():
    assert config._clean_env_value('sk-real  # 待替换') == 'sk-real'
    assert config._clean_env_value('"sk-#real"') == 'sk-#real'
    assert config._clean_env_value("'sk-real # keep'") == 'sk-real # keep'
    assert config._clean_env_value('sk-real#fragment') == 'sk-real#fragment'


def test_load_env_file_supports_export_prefix(monkeypatch, tmp_path):
    env_file = _write_env(tmp_path, 'export FOO=bar\nPLAIN=value # note\n')
    monkeypatch.delenv('FOO', raising=False)
    monkeypatch.delenv('PLAIN', raising=False)
    config._load_env_file(env_file)
    assert os.environ['FOO'] == 'bar'
    assert os.environ['PLAIN'] == 'value'
    monkeypatch.delenv('FOO', raising=False)
    monkeypatch.delenv('PLAIN', raising=False)


@pytest.mark.parametrize(
    'value',
    [
        'your-deepseek-api-key',
        'your_api_key_here',
        'YOUR-DEEPSEEK-API-KEY',
        'your-deepseek-api-key # TODO 替换',
        'sk-你的密钥',
        'changeme',
        '  "your-deepseek-api-key"  ',
    ],
)
def test_placeholder_detection(value):
    # 先按 .env 解析规则清洗，再判定，与 setup-board.sh 的调用链一致
    cleaned = config._clean_env_value(value)
    assert config.is_placeholder_value(cleaned), value


def test_real_key_is_not_placeholder():
    assert not config.is_placeholder_value('sk-e1344ec76af14e5d9323c01710501ffb')
    assert not config.is_placeholder_value('')


def test_int_env_rejects_invalid_and_negative(monkeypatch):
    assert config._int_env('DSW_TEST_INT', 7) == 7
    monkeypatch.setenv('DSW_TEST_INT', '42')
    assert config._int_env('DSW_TEST_INT', 7) == 42
    monkeypatch.setenv('DSW_TEST_INT', 'not-a-number')
    assert config._int_env('DSW_TEST_INT', 7) == 7
    monkeypatch.setenv('DSW_TEST_INT', '-3')
    assert config._int_env('DSW_TEST_INT', 7) == 7
    monkeypatch.delenv('DSW_TEST_INT')


@pytest.mark.parametrize(
    ('rate', 'configured', 'expected'),
    [
        (30, 0, 30),   # 开了速率、没设桶 → 默认一分钟的量
        (30, 50, 50),  # 显式配置优先
        (0, 0, 0),     # 全关
        (0, 10, 10),   # 只设桶容量，速率关闭时也保留
    ],
)
def test_rate_burst_fallback(rate, configured, expected):
    assert config.resolve_rate_burst(rate, configured) == expected
