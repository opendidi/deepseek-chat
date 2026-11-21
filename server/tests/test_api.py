"""HTTP 路由层测试：storage 层测试覆盖不到的响应语义、校验与安全路径。

重点回归（均曾为真 bug）：
- 1MB 以上的大会话保存（starlette 对非文件 multipart part 有 1MB 上限，session 必须走文件 part）；
- import commit 路由（曾误包 run_in_threadpool 返回 coroutine 导致 500）；
- 跨站 Origin 防线（403）。
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest

# config.py 在导入时读取 DATA_DIR，必须先于 server.app 导入设置
os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='dsw-api-')

from fastapi.testclient import TestClient  # noqa: E402

from server.app import app  # noqa: E402


@pytest.fixture(scope='module')
def client():
    # lifespan（storage.configure）在 with 上下文中执行
    with TestClient(app) as test_client:
        yield test_client


def session_payload(session_id: str, content: str = 'hello', **extra) -> dict:
    data = {
        'id': session_id,
        'title': f't-{session_id}',
        'createdAt': 1_000,
        'updatedAt': 2_000,
        'messages': [
            {'id': 'u1', 'role': 'user', 'content': content, 'files': [], 'createdAt': 1_000},
            {
                'id': 'a1',
                'role': 'assistant',
                'createdAt': 1_100,
                'model': None,
                'prefix': False,
                'status': 'done',
                'blocks': [{'type': 'text', 'text': 'answer'}],
            },
        ],
    }
    data.update(extra)
    return data


def put_session(client: TestClient, session: dict, files: dict | None = None):
    payload = {'session': ('session.json', json.dumps(session).encode(), 'application/json')}
    if files:
        payload.update(files)
    return client.put(f'/api/sessions/{session["id"]}', files=payload)


def test_health(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    data = response.json()
    assert data['ok'] is True
    # amap 字段随服务器 AMAP_KEY 配置变化，只断言存在
    assert 'amap' in data


def test_save_and_get_roundtrip(client):
    """保存后详情/列表读回一致；列表带 no-store 缓存头"""
    session = session_payload('api-1')
    assert put_session(client, session).status_code == 200

    got = client.get('/api/sessions/api-1')
    assert got.status_code == 200
    assert got.json() == session
    assert got.headers['cache-control'] == 'no-store'

    listed = client.get('/api/sessions')
    assert [item['id'] for item in listed.json()] == ['api-1']
    assert listed.headers['cache-control'] == 'no-store'


def test_save_large_session(client):
    """回归：1.2MB 的会话 JSON（非文件 part 曾被 starlette 1MB 上限拦成 400）"""
    session = session_payload('api-big', content='x' * 1_200_000)
    assert put_session(client, session).status_code == 200
    assert len(client.get('/api/sessions/api-big').json()['messages'][0]['content']) == 1_200_000


def test_import_commit_empty_staging(client):
    """回归：commit 路由曾因返回 coroutine 响应校验失败 500；空暂存时返回空列表"""
    response = client.post('/api/import/commit')
    assert response.status_code == 200
    assert response.json() == []


def test_import_full_flow(client):
    """begin → 逐会话/附件入暂存 → MIME 回填 → commit 整体替换，返回新摘要"""
    client.post('/api/import/begin')
    old = session_payload('api-old')
    assert put_session(client, old).status_code == 200

    staged = session_payload('api-new')
    assert client.post('/api/import/session', json=staged).status_code == 200
    files_response = client.post(
        '/api/import/files',
        files={'files': ('f-new', b'blob-bytes', 'application/octet-stream')},
    )
    assert files_response.status_code == 200
    assert client.patch('/api/import/file-types', json={'types': {'f-new': 'application/pdf'}}).status_code == 200

    summaries = client.post('/api/import/commit').json()
    assert [item['id'] for item in summaries] == ['api-new']
    assert client.get('/api/sessions/api-old').status_code == 404
    assert client.get('/api/sessions/api-new').status_code == 200
    assert client.get('/api/favorites').json() == []

    blob = client.get('/api/files/f-new')
    assert blob.status_code == 200
    assert blob.headers['x-content-type-options'] == 'nosniff'
    assert blob.headers['content-disposition'] == 'attachment'


def test_malformed_sessions_rejected(client):
    """畸形消息返回 400（含 actionable detail），不落库也不 500"""
    for messages, needle in [
        ([{'role': 'user', 'content': 'x', 'files': [], 'createdAt': 1}], 'id'),           # 缺 id
        ([{'id': 'm1', 'role': 'admin', 'createdAt': 1}], 'role'),                          # 非法角色
        ([{'id': 'm1', 'role': 'user', 'content': 'x', 'files': [], 'createdAt': 1},
          {'id': 'm1', 'role': 'user', 'content': 'y', 'files': [], 'createdAt': 1}], '重复'),  # 重复 id
        (['not-a-dict'], '对象'),                                                          # 非 dict 元素
    ]:
        session = session_payload('api-bad')
        session['messages'] = messages
        response = put_session(client, session)
        assert response.status_code == 400, (messages, response.status_code)
        assert needle in response.json()['detail']


def test_cross_origin_blocked(client):
    """带跨站 Origin 的简单请求被 403 拦下（CSRF/DNS rebinding 防线）"""
    assert client.get(
        '/api/sessions', headers={'Origin': 'http://evil.example'}
    ).status_code == 403
    assert client.post(
        '/api/import/commit', headers={'Origin': 'http://evil.example'}
    ).status_code == 403
    # 同源（TestClient 默认 host 为 testserver）不受影响
    assert client.get('/api/sessions', headers={'Origin': 'http://testserver'}).status_code == 200


def test_delete_session(client):
    session = session_payload('api-del')
    assert put_session(client, session).status_code == 200
    assert client.delete('/api/sessions/api-del').status_code == 204
    assert client.get('/api/sessions/api-del').status_code == 404
    assert client.delete('/api/sessions/api-del').status_code == 204  # 幂等



def test_access_key_gate(client, monkeypatch):
    """设置 ACCESS_PASSWORD 后：无口令/错口令 401，正确口令放行；health 不受保护"""
    monkeypatch.setenv('ACCESS_PASSWORD', 'secret')
    assert client.get('/api/sessions').status_code == 401
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/sessions', headers={'x-access-key': 'nope'}).status_code == 401
    assert client.get('/api/sessions', headers={'x-access-key': 'secret'}).status_code == 200
    assert client.get('/api/auth/verify', headers={'x-access-key': 'secret'}).status_code == 200
    assert client.get('/api/auth/verify', headers={'x-access-key': 'wrong'}).status_code == 401
    monkeypatch.delenv('ACCESS_PASSWORD')
    # 关闭口令后恢复开放
    assert client.get('/api/sessions').status_code == 200


def test_staticmap_endpoint(client, monkeypatch):
    """未配置 AMAP_KEY 时 400；且该端点豁免访问口令（img 无法携带自定义头）"""
    monkeypatch.setattr('server.amap.AMAP_KEY', '')
    response = client.get('/api/amap/staticmap', params={'markers': 'mid,0xFF0000:116.397,39.918'})
    assert response.status_code == 400
    assert response.json()['detail'] == 'AMAP_KEY_MISSING'

    # 口令开启后图片端点仍可访问（<img> 无法携带 x-access-key 头）
    monkeypatch.setenv('ACCESS_PASSWORD', 'secret')
    response = client.get(
        '/api/amap/staticmap',
        params={'markers': 'mid,0xFF0000:116.397,39.918'},
    )
    assert response.status_code == 400  # 无 Key 仍是 400 而非 401，证明已豁免口令

    # 配置 Key 后应返回 PNG（替身上游验证透传与响应头）
    monkeypatch.setattr('server.amap.AMAP_KEY', 'test-key')
    monkeypatch.setattr(
        'server.amap.urllib.request.urlopen',
        _FakeStaticmapUpstream(),
    )
    response = client.get(
        '/api/amap/staticmap',
        params={'markers': 'mid,0xFF0000:116.397,39.918'},
    )
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('image/png')
    assert response.headers['x-content-type-options'] == 'nosniff'


class _FakeStaticmapUpstream:
    """替身上游：staticmap 请求返回固定 PNG 字节"""

    def __call__(self, request, timeout=None):
        import io
        import types

        class _FakeResponse(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.close()

        return _FakeResponse(b'png-fake-bytes')


def test_jsconfig_endpoint(client, monkeypatch):
    """交互地图配置：未配置 JS Key 404，配置后下发 key + 安全密钥（浏览器端公开凭据）"""
    monkeypatch.setattr('server.routers.amap.AMAP_JS_KEY', '')
    assert client.get('/api/amap/jsconfig').status_code == 404

    monkeypatch.setattr('server.routers.amap.AMAP_JS_KEY', 'js-key-fake')
    monkeypatch.setattr('server.routers.amap.AMAP_SECURITY_CODE', 'js-code-fake')
    data = client.get('/api/amap/jsconfig').json()
    assert data == {'key': 'js-key-fake', 'securityCode': 'js-code-fake'}


class _FakeRouteUpstream:
    """替身上游：地理编码返回固定坐标，方向接口返回带 polyline 的步骤"""

    def __call__(self, request, timeout=None):
        import io

        url = request.full_url
        if '/geocode/geo' in url:
            payload = {'geocodes': [{'location': '116.32,39.89'}]}
        elif '/direction/' in url:
            payload = {
                'route': {
                    'paths': [
                        {
                            'steps': [
                                {'instruction': '向东', 'polyline': '116.32,39.89;116.33,39.90'},
                                {'instruction': '向北', 'polyline': '116.33,39.90;116.34,39.91'},
                            ]
                        }
                    ]
                }
            }
        else:
            payload = {}
        raw = json.dumps(payload).encode('utf-8')

        class _FakeResponse(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.close()

        return _FakeResponse(raw)


def test_routeline_endpoint(client, monkeypatch):
    """路线折线端点：起点终点解析 + 步骤 polyline 拼成坐标串；Key 缺失 400"""
    monkeypatch.setattr('server.amap.AMAP_KEY', '')
    assert client.get('/api/amap/routeline', params={'origin': '甲', 'destination': '乙'}).status_code == 400

    monkeypatch.setattr('server.amap.AMAP_KEY', 'test-key')
    monkeypatch.setattr('server.amap.urllib.request.urlopen', _FakeRouteUpstream())
    data = client.get(
        '/api/amap/routeline',
        params={'origin': '北京西站', 'destination': '首都机场', 'mode': 'driving'},
    ).json()
    assert data['found'] is True
    assert data['points'] == [[116.32, 39.89], [116.33, 39.9], [116.34, 39.91]]
