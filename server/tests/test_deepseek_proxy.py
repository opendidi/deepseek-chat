"""DeepSeek 代理测试：Key 只从服务端环境读取，浏览器不参与鉴权。

用 monkeypatch 替换 server.deepseek 里的常量与 httpx.AsyncClient，全部走内存 mock，
不访问真实模型服务、不产生费用。覆盖成功路径、缺 Key、上游错误码、网络异常与流式错误帧。
"""

from __future__ import annotations

import json

import httpx
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
        self.stream_error: Exception | None = None

    def json(self):
        return json.loads(self.content)

    async def aread(self) -> bytes:
        return self.content

    async def aiter_bytes(self):
        if self.status_code >= 400:
            return
        if self.stream_error:
            raise self.stream_error
        yield self.content


class _StreamCtx:
    def __init__(self, response: _FakeResponse):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, *args):
        return None


class _FakeAsyncClient:
    """记录最后一次请求；可注入上游响应或网络异常。"""

    last: dict = {}
    response: _FakeResponse | None = None
    error: Exception | None = None
    stream_error: Exception | None = None
    timeout: object | None = None

    def __init__(self, *args, **kwargs):
        # 记录 timeout，用于验证 SSE 与 API 端点确实使用不同的超时配置
        _FakeAsyncClient.timeout = kwargs.get('timeout')

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, url, headers=None):
        _FakeAsyncClient.last = {'method': 'GET', 'url': url, 'headers': headers or {}}
        if _FakeAsyncClient.error:
            raise _FakeAsyncClient.error
        return _FakeAsyncClient.response or _FakeResponse(b'{"data":[{"id":"deepseek-flash"}]}')

    async def post(self, url, headers=None, data=None, files=None, content=None):
        _FakeAsyncClient.last = {
            'method': 'POST',
            'url': url,
            'headers': headers or {},
            'data': data,
            'files': files,
            'content': content,
        }
        if _FakeAsyncClient.error:
            raise _FakeAsyncClient.error
        return _FakeAsyncClient.response or _FakeResponse(b'{"id":"file-1"}')

    def stream(self, method, url, headers=None, content=None):
        _FakeAsyncClient.last = {
            'method': method,
            'url': url,
            'headers': headers or {},
            'content': content,
        }
        if _FakeAsyncClient.error:
            raise _FakeAsyncClient.error
        response = _FakeAsyncClient.response or _FakeResponse(
            b'event: message_start\ndata: {}\n\n'
        )
        if _FakeAsyncClient.stream_error:
            response.stream_error = _FakeAsyncClient.stream_error
        return _StreamCtx(response)


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(deepseek, 'DEEPSEEK_API_KEY', 'sk-test-secret')
    monkeypatch.setattr(deepseek, 'DEEPSEEK_BASE_URL', 'https://api.example.test')
    monkeypatch.setattr(deepseek.httpx, 'AsyncClient', _FakeAsyncClient)
    _FakeAsyncClient.last = {}
    _FakeAsyncClient.response = None
    _FakeAsyncClient.error = None
    _FakeAsyncClient.stream_error = None
    _FakeAsyncClient.timeout = None


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
    """生成器内的错误路由抓不到，必须在返回 StreamingResponse 前检查。"""
    monkeypatch.setattr(deepseek, 'DEEPSEEK_API_KEY', '')
    response = client.post('/api/deepseek/messages', json={})
    assert response.status_code == 400
    assert response.json()['code'] == 'DEEPSEEK_KEY_MISSING'


@pytest.mark.parametrize(
    ('status', 'body', 'expected_message'),
    [
        (402, {'error': {'message': 'Insufficient Balance'}}, 'Insufficient Balance'),
        (429, {'error': {'message': 'Rate limited'}}, 'Rate limited'),
        (401, {'error': {'message': 'invalid api key'}}, 'invalid api key'),
        (500, {'detail': 'upstream crash'}, 'upstream crash'),
    ],
)
def test_non_stream_upstream_error_keeps_status(client, status, body, expected_message):
    _FakeAsyncClient.response = _FakeResponse(json.dumps(body).encode(), status)
    response = client.get('/api/deepseek/models')
    assert response.status_code == status
    assert response.json()['detail'] == expected_message
    assert response.json()['code'] == 'UPSTREAM_ERROR'
    # 前端据此区分「上游 Key 失效」与「本机访问口令失效」，不能误弹口令门
    assert response.headers['x-proxy-error'] == 'upstream'


@pytest.mark.parametrize(
    ('status', 'body'),
    [
        (402, {'error': {'message': 'Insufficient Balance'}}),
        (429, {'error': {'message': 'Rate limited'}}),
        (401, {'error': {'message': 'invalid api key'}}),
    ],
)
def test_stream_upstream_error_becomes_sse_error_frame(client, status, body):
    """上游错误不再被 200 开头的空流吞掉，而是带 status/code 的 error 帧。"""
    _FakeAsyncClient.response = _FakeResponse(json.dumps(body).encode(), status)
    response = client.post('/api/deepseek/messages', json={})
    assert response.status_code == 200
    assert 'event: error' in response.text
    frame = next(
        line[len('data: ') :]
        for line in response.text.splitlines()
        if line.startswith('data: ')
    )
    payload = json.loads(frame)
    assert payload['status'] == status
    assert payload['code'] == 'UPSTREAM_ERROR'
    assert payload['error']['message'] == body['error']['message']


def test_network_error_non_stream_returns_friendly_json(client):
    _FakeAsyncClient.error = httpx.ConnectError('boom')
    response = client.get('/api/deepseek/models')
    assert response.status_code == 502
    assert response.json()['code'] == 'UPSTREAM_UNREACHABLE'
    assert '无法连接' in response.json()['detail']


def test_timeout_non_stream_returns_504(client):
    _FakeAsyncClient.error = httpx.ReadTimeout('slow')
    response = client.get('/api/deepseek/models')
    assert response.status_code == 504
    assert response.json()['code'] == 'UPSTREAM_UNREACHABLE'


def test_network_error_stream_becomes_error_frame(client):
    _FakeAsyncClient.error = httpx.ConnectError('boom')
    response = client.post('/api/deepseek/messages', json={})
    assert response.status_code == 200
    assert 'UPSTREAM_UNREACHABLE' in response.text


def test_upload_limit_rejects_oversized_body(client):
    """ASR 上限 10MiB；超限应在解析 multipart 前返回 413。"""
    oversized = b'x' * (10 * 1024 * 1024 + 1)
    response = client.post(
        '/api/deepseek/tools/asr',
        files={'file': ('big.wav', oversized, 'audio/wav')},
    )
    assert response.status_code == 413
    assert response.json()['code'] == 'UPLOAD_TOO_LARGE'


def test_upstream_error_string_message_parsed(client):
    """上游 error 为纯字符串时也能提取文案。"""
    _FakeAsyncClient.response = _FakeResponse(
        json.dumps({'error': 'quota exceeded'}).encode(), 402
    )
    response = client.get('/api/deepseek/models')
    assert response.status_code == 402
    assert response.json()['detail'] == 'quota exceeded'


def test_stream_midway_disconnect_becomes_error_frame(client):
    """SSE 已开始后上游断流：转成 UPSTREAM_UNREACHABLE 帧，而不是抛异常/截断空流。"""
    _FakeAsyncClient.stream_error = httpx.RemoteProtocolError('connection reset')
    response = client.post('/api/deepseek/messages', json={})
    assert response.status_code == 200
    assert 'event: error' in response.text
    assert 'UPSTREAM_UNREACHABLE' in response.text


def test_asr_and_tts_inject_server_key(client):
    """语音端点同样由服务端注入 Key，浏览器不接触。"""
    _FakeAsyncClient.response = _FakeResponse(b'{"text":"hello"}')
    asr = client.post(
        '/api/deepseek/tools/asr', files={'file': ('a.wav', b'audio', 'audio/wav')}
    )
    assert asr.status_code == 200
    assert asr.json()['text'] == 'hello'
    assert _FakeAsyncClient.last['headers']['Authorization'] == 'Bearer sk-test-secret'

    _FakeAsyncClient.response = _FakeResponse(b'\x00\x01')
    tts = client.post('/api/deepseek/tools/tts', json={'text': 'hi'})
    assert tts.status_code == 200
    assert tts.content == b'\x00\x01'
    assert _FakeAsyncClient.last['headers']['Authorization'] == 'Bearer sk-test-secret'


def test_files_endpoint_injects_server_key(client):
    client.post('/api/deepseek/files', files={'file': ('a.png', b'x', 'image/png')})
    assert _FakeAsyncClient.last['headers']['Authorization'] == 'Bearer sk-test-secret'


def test_sse_and_api_use_different_timeouts(client):
    """SSE 需要长 read 超时；非流端点应当快速失败。"""
    client.post('/api/deepseek/messages', json={})
    sse_timeout = _FakeAsyncClient.timeout
    client.get('/api/deepseek/models')
    api_timeout = _FakeAsyncClient.timeout
    assert sse_timeout is not None and api_timeout is not None
    assert sse_timeout.read > api_timeout.read


def test_upstream_error_message_is_truncated(client):
    """超长上游文案不应原样回显给浏览器。"""
    long_message = 'x' * 2000
    _FakeAsyncClient.response = _FakeResponse(
        json.dumps({'error': {'message': long_message}}).encode(), 400
    )
    response = client.get('/api/deepseek/models')
    assert len(response.json()['detail']) <= 500
