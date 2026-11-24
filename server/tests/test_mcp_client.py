"""MCP 零依赖客户端测试：用真实的假 MCP 服务器子进程走完整 JSON-RPC 链路。"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='dsw-mcp-')

from fastapi.testclient import TestClient  # noqa: E402

from server import mcp_client  # noqa: E402
from server.app import app  # noqa: E402
from server.storage import core as storage  # noqa: E402

# 一个最小 MCP 服务器：换行分帧的 JSON-RPC，支持 initialize / tools/list / tools/call
FAKE_SERVER = r'''
import json, sys
for raw in sys.stdin:
    try:
        msg = json.loads(raw)
    except Exception:
        continue
    method = msg.get('method')
    rid = msg.get('id')
    if method == 'initialize':
        result = {'protocolVersion': '2025-06-18', 'capabilities': {}, 'serverInfo': {'name': 'fake', 'version': '1'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'echo', 'description': '回显输入', 'inputSchema': {'type': 'object', 'properties': {'text': {'type': 'string'}}}}]}
    elif method == 'tools/call':
        text = (msg.get('params', {}).get('arguments') or {}).get('text', '')
        result = {'content': [{'type': 'text', 'text': 'echo:' + str(text)}]}
    elif method == 'notifications/initialized':
        continue
    else:
        result = {}
    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': rid, 'result': result}, ensure_ascii=False) + '\n')
    sys.stdout.flush()
'''

CRASH_SERVER = r'''
import sys
sys.stderr.write('boom from fake server\n')
sys.stderr.flush()
sys.exit(1)
'''


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _isolate_manager(tmp_path, monkeypatch):
    # 每个用例用独立临时 DB + 独立会话，彻底隔离配置状态
    asyncio.run(mcp_client.manager.close_all())
    storage.configure(tmp_path)
    legacy = tmp_path / 'mcp.json'
    monkeypatch.setattr(mcp_client, 'LEGACY_CONFIG_PATH', legacy)
    yield tmp_path
    asyncio.run(mcp_client.manager.close_all())


def write_config(path: Path, *, enabled: bool = True, command: str | None = None, script: str = FAKE_SERVER):
    """写入当前用例的 DB 配置（不再是文件）。"""
    script_file = path / 'server.py'
    script_file.write_text(script, encoding='utf-8')
    cmd = command or sys.executable
    args = [str(script_file)] if command is None else []
    mcp_client.write_config({'servers': {
        'fake': {'enabled': enabled, 'command': cmd, 'args': args, 'timeout': 5},
    }})
    return path


def test_no_config_returns_empty(client, _isolate_manager):
    assert client.get('/api/mcp/status').json() == {'configured': False, 'servers': []}
    assert client.get('/api/mcp/tools').json() == []


def test_disabled_server_not_loaded(_isolate_manager):
    write_config(_isolate_manager, enabled=False)
    assert mcp_client.load_servers() == []


def test_load_tools_and_call(client, _isolate_manager):
    write_config(_isolate_manager)
    status = client.get('/api/mcp/status').json()
    assert status == {'configured': True, 'servers': ['fake']}

    tools = client.get('/api/mcp/tools').json()
    assert len(tools) == 1
    assert tools[0]['name'] == 'mcp__fake__echo'
    assert tools[0]['input_schema']['type'] == 'object'

    result = client.post('/api/mcp/call', json={
        'name': 'mcp__fake__echo',
        'arguments': {'text': '你好'},
    }).json()
    assert result['content'] == 'echo:你好'


def test_call_rejects_invalid_name(client, _isolate_manager):
    write_config(_isolate_manager)
    response = client.post('/api/mcp/call', json={'name': 'echo', 'arguments': {}})
    assert response.status_code == 502
    assert response.json()['code'] == 'MCP_ERROR'


def test_call_rejects_bad_body(client, _isolate_manager):
    write_config(_isolate_manager)
    assert client.post('/api/mcp/call', json={'name': 123}).status_code == 400
    assert client.post('/api/mcp/call', json={'name': 'x', 'arguments': 'bad'}).status_code == 400


def test_crashed_server_reports_error(client, _isolate_manager):
    write_config(_isolate_manager, script=CRASH_SERVER)
    response = client.get('/api/mcp/tools')
    assert response.status_code == 200
    # 列工具失败时返回空列表，不阻断应用
    assert response.json() == []
    # 直接调用才有明确错误
    result = client.post('/api/mcp/call', json={
        'name': 'mcp__fake__echo', 'arguments': {}
    })
    assert result.status_code == 502
    assert '意外退出' in result.json()['detail']


def test_env_expansion_and_timeout(_isolate_manager):
    write_config(_isolate_manager)
    config = mcp_client.load_servers()[0]
    assert config.timeout == 5
    assert config.command == sys.executable


# --- HTTP 传输 / 热重载 / isError ---

def test_http_transport_lists_and_calls(client, monkeypatch, _isolate_manager):
    """Streamable HTTP：initialize + tools/list + tools/call，带会话 ID 与协议版本头。"""
    seen_headers: list[dict] = []

    def handler(request):
        import httpx
        seen_headers.append(dict(request.headers))
        body = json.loads(request.content)
        method = body.get('method')
        rid = body.get('id')
        if method == 'initialize':
            result = {'protocolVersion': '2025-06-18', 'capabilities': {}, 'serverInfo': {'name': 'http', 'version': '1'}}
            return httpx.Response(200, json={'jsonrpc': '2.0', 'id': rid, 'result': result},
                                  headers={'Mcp-Session-Id': 'sid-123'})
        if method == 'notifications/initialized':
            return httpx.Response(202)
        if method == 'tools/list':
            return httpx.Response(200, text='event: message\ndata: ' + json.dumps({
                'jsonrpc': '2.0', 'id': rid,
                'result': {'tools': [{'name': 'ping', 'description': 'ping', 'inputSchema': {'type': 'object', 'properties': {}}}]},
            }) + '\n\n', headers={'Content-Type': 'text/event-stream'})
        if method == 'tools/call':
            return httpx.Response(200, json={'jsonrpc': '2.0', 'id': rid,
                                             'result': {'content': [{'type': 'text', 'text': 'pong'}]}})
        return httpx.Response(400)

    original_post = mcp_client.httpx.AsyncClient.post

    async def fake_post(self, url, **kwargs):
        return handler(mcp_client.httpx.Request('POST', url, json=kwargs.get('json'), headers=kwargs.get('headers', {})))

    monkeypatch.setattr(mcp_client.httpx.AsyncClient, 'post', fake_post)
    try:
        mcp_client.write_config({'servers': {
            'remote': {'enabled': True, 'url': 'https://example.com/mcp', 'timeout': 5}
        }})

        tools = client.get('/api/mcp/tools').json()
        assert len(tools) == 1
        assert tools[0]['name'] == 'mcp__remote__ping'
        # 会话 ID 与协议版本头必须带到后续请求
        assert any(h.get('mcp-session-id') == 'sid-123' for h in seen_headers)
        assert any(h.get('mcp-protocol-version') == '2025-06-18' for h in seen_headers)

        result = client.post('/api/mcp/call', json={'name': 'mcp__remote__ping', 'arguments': {}}).json()
        assert result == {'content': 'pong', 'isError': False}
    finally:
        monkeypatch.setattr(mcp_client.httpx.AsyncClient, 'post', original_post)


def test_is_error_flag_passed_through(client, _isolate_manager):
    script = FAKE_SERVER.replace(
        "result = {'content': [{'type': 'text', 'text': 'echo:' + str(text)}]}",
        "result = {'isError': True, 'content': [{'type': 'text', 'text': 'tool failed'}]}")
    write_config(_isolate_manager, script=script)
    result = client.post('/api/mcp/call', json={
        'name': 'mcp__fake__echo', 'arguments': {'text': 'x'}
    }).json()
    assert result == {'content': 'tool failed', 'isError': True}


def test_config_hot_reload(client, _isolate_manager):
    """改 mcp.json 后无需重启即可生效：先禁用→无工具，再启用→有工具。"""
    write_config(_isolate_manager, enabled=False)
    assert client.get('/api/mcp/tools').json() == []
    write_config(_isolate_manager, enabled=True)
    tools = client.get('/api/mcp/tools').json()
    assert len(tools) == 1, '配置变动后应自动重载并列出工具'
    assert client.get('/api/mcp/status').json()['configured'] is True


def test_reload_endpoint(client, _isolate_manager):
    write_config(_isolate_manager)
    response = client.post('/api/mcp/reload')
    assert response.status_code == 200
    assert response.json() == {'ok': True, 'servers': ['fake']}


def test_server_name_with_double_underscore_rejected(_isolate_manager):
    # 含 __ 的服务器名在配置校验层就被拒绝（工具名分隔符歧义）
    with pytest.raises(mcp_client.McpError):
        mcp_client.validate_config({'servers': {
            'bad__name': {'enabled': True, 'command': sys.executable}
        }})
    assert mcp_client.load_servers() == []


def test_stderr_drained_without_deadlock(client, _isolate_manager):
    """服务器往 stderr 写大量日志时不应阻塞（旧实现会因管道满死锁）。"""
    noisy = '''
import json, sys
sys.stderr.write('x' * 200000)
sys.stderr.flush()
for raw in sys.stdin:
    try: msg = json.loads(raw)
    except Exception: continue
    m, rid = msg.get('method'), msg.get('id')
    if m == 'initialize': r = {'protocolVersion': '2025-06-18', 'capabilities': {}, 'serverInfo': {'name':'n','version':'1'}}
    elif m == 'tools/list': r = {'tools': []}
    elif m == 'notifications/initialized': continue
    else: r = {}
    sys.stdout.write(json.dumps({'jsonrpc':'2.0','id':rid,'result':r}) + '\\n')
    sys.stdout.flush()
'''
    write_config(_isolate_manager, script=noisy)
    response = client.get('/api/mcp/tools')
    assert response.status_code == 200
    assert response.json() == []


# --- 设置页配置读写 ---

def test_get_config_returns_full_config_including_disabled(client, _isolate_manager):
    mcp_client.write_config({'servers': {
        'off': {'enabled': False, 'command': 'python', 'args': ['x.py']},
    }})
    data = client.get('/api/mcp/config').json()
    assert data['servers']['off']['enabled'] is False
    assert data['canWrite'] is True


def test_put_config_writes_and_reloads(client, _isolate_manager):
    write_config(_isolate_manager, enabled=False)
    payload = {'servers': {
        'fresh': {'enabled': True, 'url': 'https://example.com/mcp', 'timeout': 12},
    }}
    response = client.put('/api/mcp/config', json=payload)
    assert response.status_code == 200
    assert response.json()['ok'] is True
    assert mcp_client.read_config()['servers']['fresh']['url'] == 'https://example.com/mcp'
    assert client.get('/api/mcp/status').json() == {'configured': True, 'servers': ['fresh']}


@pytest.mark.parametrize('payload', [
    {'servers': {'bad__name': {'enabled': True, 'command': 'python'}}},
    {'servers': {'x': {'enabled': True}}},
    {'servers': {'x': {'enabled': True, 'url': 'ftp://x/mcp'}}},
    {'servers': {'x': {'enabled': True, 'command': 'python', 'timeout': 0}}},
    {'servers': {'x': {'enabled': True, 'command': 'python', 'timeout': 9999}}},
    {'servers': {'x': {'enabled': True, 'command': 'python', 'args': 'not-a-list'}}},
    {'servers': 'not-a-dict'},
])
def test_put_config_rejects_invalid(client, _isolate_manager, payload):
    write_config(_isolate_manager, enabled=False)
    response = client.put('/api/mcp/config', json=payload)
    assert response.status_code == 400
    assert response.json()['code'] == 'MCP_CONFIG_INVALID'
    # 校验失败不能改动原文件
    assert mcp_client.read_config()['servers']['fake']['enabled'] is False


def test_remote_write_blocked_without_password(client, _isolate_manager, monkeypatch):
    monkeypatch.delenv('ACCESS_PASSWORD', raising=False)
    response = client.put(
        '/api/mcp/config',
        json={'servers': {'evil': {'enabled': True, 'command': 'sh'}}},
        headers={'x-forwarded-for': '203.0.113.9'},
    )
    assert response.status_code == 403
    assert response.json()['code'] == 'MCP_WRITE_FORBIDDEN'
    assert client.get('/api/mcp/config', headers={'x-forwarded-for': '203.0.113.9'}).json()['canWrite'] is False


def test_write_allowed_with_password(client, _isolate_manager, monkeypatch):
    monkeypatch.setenv('ACCESS_PASSWORD', 'secret')
    response = client.put(
        '/api/mcp/config',
        json={'servers': {'ok': {'enabled': False, 'command': 'python'}}},
        headers={'x-forwarded-for': '203.0.113.9', 'x-access-key': 'secret'},
    )
    assert response.status_code == 200


# --- SQLite 持久化与一次性迁移 ---

def test_config_persists_in_db_across_reconfigure(_isolate_manager):
    """配置写进 chats.db：重开连接后仍在，与会话数据一起备份/迁移。"""
    mcp_client.write_config({'servers': {
        'persisted': {'enabled': True, 'url': 'https://example.com/mcp'},
    }})
    conn = storage.connect()
    try:
        row = conn.execute('SELECT payload FROM mcp_config WHERE id = 1').fetchone()
    finally:
        conn.close()
    assert row is not None
    assert json.loads(row['payload'])['servers']['persisted']['enabled'] is True
    # 新连接读取同一份数据
    assert mcp_client.read_config()['servers']['persisted']['url'] == 'https://example.com/mcp'


def test_legacy_file_migrated_once(_isolate_manager, monkeypatch):
    """旧项目根 mcp.json 只在首次启动时导入，之后删除文件也不影响。"""
    legacy = _isolate_manager / 'legacy.json'
    legacy.write_text(json.dumps({'servers': {
        'legacy': {'enabled': True, 'command': 'python', 'args': ['x.py']},
    }}), encoding='utf-8')
    monkeypatch.setattr(mcp_client, 'LEGACY_CONFIG_PATH', legacy)
    assert mcp_client.migrate_legacy_config() is True
    assert 'legacy' in mcp_client.read_config()['servers']
    # 再迁移：DB 已有配置，直接跳过
    assert mcp_client.migrate_legacy_config() is False
    legacy.unlink()
    assert 'legacy' in mcp_client.read_config()['servers']


def test_legacy_invalid_file_ignored(_isolate_manager, monkeypatch):
    legacy = _isolate_manager / 'legacy.json'
    legacy.write_text('{ broken', encoding='utf-8')
    monkeypatch.setattr(mcp_client, 'LEGACY_CONFIG_PATH', legacy)
    assert mcp_client.migrate_legacy_config() is False
    assert mcp_client.read_config() == {'servers': {}}


def test_config_signature_triggers_reload(_isolate_manager):
    """改配置（不通过 reload）后 ensure_fresh 自动重载会话。"""
    mcp_client.write_config({'servers': {}})
    asyncio.run(mcp_client.manager.ensure_fresh())
    assert mcp_client.manager._config_signature is not None
    before = mcp_client.manager._config_signature
    mcp_client.write_config({'servers': {
        'new': {'enabled': False, 'command': 'python'},
    }})
    changed = asyncio.run(mcp_client.manager.ensure_fresh())
    assert changed is True
    assert mcp_client.manager._config_signature != before
