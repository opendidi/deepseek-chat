"""DeepSeek 代理测试：Key 只从服务端环境读取，浏览器不参与鉴权。

用 monkeypatch 替换 server.deepseek 里的常量与 httpx.AsyncClient，全部走内存 mock，
不访问真实模型服务、不产生费用。
"""

from __future__ import annotations

import json

import pytest

from fastapi.testclient import TestClient  # noqa: E402

import server.deepseek as deepseek
from server.app import app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


class _FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200, headers: dict | None = None):
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}

    def json(self):
        return json.loads(self.content)

    async def aread(self) -> bytes:
        return self.content

    async def aiter_bytes(self):
        yield self.content


class _FakeAsyncClient:
    """记录最后一次请求的 URL / headers / body，返回预置响应。"""

    last: dict = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, url, headers=None):
        _FakeAsyncClient.last = {'method': 'GET', 'url': url, 'headers': headers or {}}
        return _FakeResponse(b'{"data":[{"id":"deepseek-flash"}]}')

    async def post(self, url, headers=None, data=None, files=None, content=None):
        _FakeAsyncClient.last = {
            'method': 'POST',
            'url': url,
            'headers': headers or {},
            'data': data,
            'files': files,
            'content': content,
        }
        return _FakeResponse(b'{"id":"file-1"}')

    def stream(self, method, url, headers=None, content=None):
        _FakeAsyncClient.last = {
            'method': method,
            'url': url,
            'headers': headers or {},
            'content': content,
        }

        class _Ctx:
            async def __aenter__(self):
                return _FakeResponse(b'event: message_start\ndata: {}\n\n')

            async def __aexit__(self, *args):
                return None

        return _Ctx()


@pytest.fixture(autouse=True)
def _reset_key(monkeypatch):
    monkeypatch.setattr(deepseek, 'DEEPSEEK_API_KEY', 'sk-test-secret')
    monkeypatch.setattr(deepseek, 'DEEPSEEK_BASE_URL', 'https://api.example.test')
    monkeypatch.setattr(deepseek.httpx, 'AsyncClient', _FakeAsyncClient)
    _FakeAsyncClient.last = {}


def test_models_injects_server_key(client):
    response = client.get('/api/deepseek/models')
    assert response.status_code == 200
    assert _FakeAsyncClient.last['url'] == 'https://api.example.test/models'
    assert _FakeAsyncClient.last['headers']['Authorization'] == 'Bearer sk-test-secret'


def test_messages_stream_forwards_sse(client):
    response = client.post('/api/deepseek/messages', json={'model': 'deepseek-flash'})
    assert response.status_code == 200
    assert 'text/event-stream' in response.headers['content-type']
    assert 'event: message_start' in response.text
    sent = json.loads(_FakeAsyncClient.last['content'])
    assert sent == {'model': 'deepseek-flash'}
    assert _FakeAsyncClient.last['headers']['Authorization'] == 'Bearer sk-test-secret'


def test_files_upload_keeps_purpose_and_beta(client):
    response = client.post(
        '/api/deepseek/files',
        files={'file': ('a.png', b'bytes', 'image/png')},
        data={'purpose': 'assistant_output'},
    )
    assert response.status_code == 200
    assert _FakeAsyncClient.last['data'] == {'purpose': 'assistant_output'}
    assert _FakeAsyncClient.last['headers']['anthropic-beta'] == 'files-api-2025-04-14'


def test_missing_key_returns_fixed_code(client, monkeypatch):
    monkeypatch.setattr(deepseek, 'DEEPSEEK_API_KEY', '')
    response = client.get('/api/deepseek/models')
    assert response.status_code == 400
    assert response.json()['code'] == 'DEEPSEEK_KEY_MISSING'


def test_messages_missing_key_fails_before_stream(client, monkeypatch):
    """SSE 生成器内的错误路由抓不到，必须在返回 StreamingResponse 前检查。"""
    monkeypatch.setattr(deepseek, 'DEEPSEEK_API_KEY', '')
    response = client.post('/api/deepseek/messages', json={})
    assert response.status_code == 400
    assert response.json()['code'] == 'DEEPSEEK_KEY_MISSING'
