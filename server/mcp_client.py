"""轻量 MCP 客户端：零新增依赖，用标准库 stdio + JSON-RPC 2.0 对接本地 MCP 服务器。

只实现本项目需要的两个能力：tools/list（列出工具）与 tools/call（调用工具）。
配置与会话数据一起存在 data/chats.db 的 mcp_config 表，由设置页动态编辑；
项目根旧的 mcp.json 仅在首次启动时一次性导入（兼容手工配置），之后不再读取。

设计约束：
- 每个服务器一个长驻子进程，首次调用时才启动（lazy），失败不阻断应用启动；
- JSON-RPC 以换行分帧（MCP stdio 规范），响应按 id 匹配；
- 所有请求有超时；进程崩溃/超时后丢弃会话，下次调用重新拉起；
- 工具名统一加 `mcp__<server>__<tool>` 前缀，避免与浏览器端内置工具冲突。
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .config import REPO_ROOT
from .storage import core as storage

# 仅用于一次性迁移：旧版手工放置的项目根 mcp.json
LEGACY_CONFIG_PATH = REPO_ROOT / 'mcp.json'

PROTOCOL_VERSION = '2025-06-18'
CLIENT_INFO = {'name': 'deepseek-chat', 'version': '1.0'}

NAME_PREFIX = 'mcp__'
DEFAULT_TIMEOUT = 30.0
MAX_RESULT_CHARS = 20_000


class McpError(Exception):
    """MCP 调用失败：message 可直接展示给用户，不含底层堆栈。"""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass
class ServerConfig:
    name: str
    # command/args 走 stdio；url 走 Streamable HTTP，二者二选一
    command: str = ''
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    url: str = ''
    headers: dict[str, str] = field(default_factory=dict)
    timeout: float = DEFAULT_TIMEOUT

    @property
    def transport(self) -> str:
        return 'http' if self.url else 'stdio'


@dataclass
class McpTool:
    """暴露给前端的工具声明；name 已加前缀。"""

    name: str
    server: str
    original_name: str
    description: str
    input_schema: dict[str, Any]


def load_servers(config: dict[str, Any] | None = None) -> list[ServerConfig]:
    """读取已启用的 MCP 服务器；数据源为 chats.db，config 参数供测试直接注入。"""
    data = config if config is not None else read_config()
    raw = data.get('servers') if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return []

    servers: list[ServerConfig] = []
    for name, item in raw.items():
        # 服务器名会进入 mcp__<server>__<tool> 工具名，含 __ 会导致解析歧义
        if not isinstance(name, str) or '__' in name:
            continue
        if not isinstance(item, dict) or not item.get('enabled'):
            continue
        command = item.get('command')
        url = item.get('url')
        # stdio 需要 command；HTTP 需要合法 http(s) url
        if url is not None:
            if not isinstance(url, str) or not url.startswith(('http://', 'https://')):
                continue
        elif not isinstance(command, str) or not command.strip():
            continue
        args = item.get('args') or []
        env = item.get('env') or {}
        headers = item.get('headers') or {}
        timeout = item.get('timeout') or DEFAULT_TIMEOUT
        try:
            timeout = float(timeout)
        except (TypeError, ValueError):
            timeout = DEFAULT_TIMEOUT
        servers.append(
            ServerConfig(
                name=name,
                command=command if isinstance(command, str) else '',
                args=[str(a).replace('${REPO_ROOT}', str(REPO_ROOT)) for a in args] if isinstance(args, list) else [],
                env={str(k): str(v) for k, v in env.items()} if isinstance(env, dict) else {},
                url=url if isinstance(url, str) else '',
                headers={str(k): str(v) for k, v in headers.items()} if isinstance(headers, dict) else {},
                timeout=timeout,
            )
        )
    return servers


class StdioSession:
    """一个 MCP 服务器子进程 + 请求/响应配对。"""

    def __init__(self, config: ServerConfig):
        self.config = config
        self.proc: asyncio.subprocess.Process | None = None
        self.request_id = 0
        self.lock = asyncio.Lock()
        self._failed: str | None = None
        self._stderr_task: asyncio.Task | None = None
        self._stderr_tail: str = ''

    async def _ensure_started(self) -> None:
        if self.proc is not None and self.proc.returncode is None:
            return
        if self._failed:
            raise McpError(self._failed)
        try:
            env = os.environ.copy()
            env.update(self.config.env)
            # PYTHONUNBUFFERED 让 Python MCP 服务器立即刷新 stdout，避免换行帧卡住
            env.setdefault('PYTHONUNBUFFERED', '1')
            self.proc = await asyncio.create_subprocess_exec(
                self.config.command,
                *self.config.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=str(REPO_ROOT),
            )
            # 必须持续排空 stderr：MCP 服务器若把日志写到 stderr，管道缓冲区满会阻塞其运行
            if self.proc.stderr is not None:
                self._stderr_task = asyncio.create_task(self._drain_stderr(self.proc.stderr))
            await self._initialize()
        except McpError as error:
            # 初始化失败时清理已启动的进程，避免留下孤儿
            await self.close()
            self._failed = error.message
            raise
        except (OSError, asyncio.TimeoutError) as error:
            await self.close()
            self._failed = f'MCP 服务器 {self.config.name} 启动失败：{error}'
            raise McpError(self._failed)

    async def _drain_stderr(self, stream: asyncio.StreamReader) -> None:
        """后台排空 stderr，保留最后 200 字节用于崩溃诊断。"""
        tail = b''
        try:
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    break
                tail = (tail + chunk)[-200:]
        except (OSError, asyncio.CancelledError):
            return
        self._stderr_tail = tail.decode('utf-8', 'replace').strip()

    async def _initialize(self) -> None:
        result = await self._request(
            'initialize',
            {
                'protocolVersion': PROTOCOL_VERSION,
                'capabilities': {},
                'clientInfo': CLIENT_INFO,
            },
        )
        if not isinstance(result, dict):
            raise McpError(f'MCP 服务器 {self.config.name} 初始化响应无效')
        # 按规范发 initialized 通知（无 id，不需要响应）
        self.request_id += 1
        await self._write(
            {
                'jsonrpc': '2.0',
                'method': 'notifications/initialized',
                'params': {},
            }
        )

    async def _write(self, message: dict[str, Any]) -> None:
        assert self.proc is not None and self.proc.stdin is not None
        line = json.dumps(message, ensure_ascii=False) + '\n'
        self.proc.stdin.write(line.encode('utf-8'))
        await self.proc.stdin.drain()

    async def _request(self, method: str, params: dict[str, Any]) -> Any:
        self.request_id += 1
        request_id = self.request_id
        await self._write({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params})
        assert self.proc is not None and self.proc.stdout is not None
        while True:
            raw = await asyncio.wait_for(
                self.proc.stdout.readline(), timeout=self.config.timeout
            )
            if not raw:
                # 进程已退出：读 stderr 首行给个可诊断信息
                # stderr 由后台任务持续排空，这里直接读缓存的尾部
                if self._stderr_task is not None:
                    try:
                        await asyncio.wait_for(self._stderr_task, timeout=1)
                    except (asyncio.TimeoutError, asyncio.CancelledError):
                        pass
                detail = self._stderr_tail.splitlines()[0][:200] if self._stderr_tail else ''
                raise McpError(
                    f'MCP 服务器 {self.config.name} 意外退出{detail and "：" + detail}'
                )
            try:
                message = json.loads(raw.decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError):
                # 非 JSON 行（服务器日志）按规范不应出现在 stdout，忽略
                continue
            if message.get('id') != request_id:
                # 通知或其他请求，跳过
                continue
            if 'error' in message:
                error = message['error']
                text = error.get('message', '未知错误') if isinstance(error, dict) else str(error)
                raise McpError(f'MCP {self.config.name} {method} 失败：{text}')
            return message.get('result')

    async def call(self, method: str, params: dict[str, Any]) -> Any:
        """带锁的串行调用：一个 stdio 连接同一时刻只能处理一个请求。"""
        async with self.lock:
            await self._ensure_started()
            try:
                return await self._request(method, params)
            except asyncio.TimeoutError:
                # 超时后丢弃会话，下次重新拉起；把裸 TimeoutError 转成可展示文案
                await self.close()
                raise McpError(
                    f'MCP 服务器 {self.config.name} 调用超时（{self.config.timeout:g}s）'
                )
            except McpError:
                # 服务器报错/崩溃同样丢弃会话，避免后续请求卡在坏连接上
                await self.close()
                raise

    async def close(self, *, permanent: bool = False) -> None:
        proc = self.proc
        self.proc = None
        if permanent:
            # 永久关闭（配置重载）时清除失败状态，服务器修好后可重试
            self._failed = None
            self._stderr_tail = ''
        if proc is None:
            return
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
        if self._stderr_task is not None:
            self._stderr_task.cancel()
            try:
                await self._stderr_task
            except asyncio.CancelledError:
                pass
            self._stderr_task = None



class HttpSession:
    """Streamable HTTP 传输：POST JSON-RPC，响应为 JSON 或 SSE，支持会话 ID。"""

    def __init__(self, config: ServerConfig):
        self.config = config
        self.client: httpx.AsyncClient | None = None
        self.request_id = 0
        self.lock = asyncio.Lock()
        self.session_id: str | None = None
        self.protocol_version = PROTOCOL_VERSION
        self._initialized = False

    async def _ensure_started(self) -> None:
        if self.client is not None and self._initialized:
            return
        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            **self.config.headers,
        }
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.config.timeout),
            headers=headers,
            follow_redirects=True,
        )
        result = await self._request('initialize', {
            'protocolVersion': PROTOCOL_VERSION,
            'capabilities': {},
            'clientInfo': CLIENT_INFO,
        })
        if not isinstance(result, dict):
            raise McpError(f'MCP 服务器 {self.config.name} 初始化响应无效')
        # 协商版本：服务器返回的版本优先
        negotiated = result.get('protocolVersion')
        if isinstance(negotiated, str) and negotiated:
            self.protocol_version = negotiated
        self._initialized = True
        # initialized 通知：服务端返回 202，无需等待响应
        await self._notify('notifications/initialized', {})

    def _post_headers(self) -> dict[str, str]:
        headers = {'MCP-Protocol-Version': self.protocol_version}
        if self.session_id:
            headers['Mcp-Session-Id'] = self.session_id
        return headers

    @staticmethod
    def _parse_sse(text: str, request_id: int) -> Any:
        """从 SSE 流里找 id 匹配的 JSON-RPC 响应；忽略通知与其他请求。"""
        for block in text.split('\n\n'):
            data_lines = [
                line[5:].strip() for line in block.splitlines()
                if line.startswith('data:')
            ]
            if not data_lines:
                continue
            try:
                message = json.loads('\n'.join(data_lines))
            except json.JSONDecodeError:
                continue
            if message.get('id') != request_id or 'result' not in message and 'error' not in message:
                continue
            if 'error' in message:
                error = message['error']
                text = error.get('message', '未知错误') if isinstance(error, dict) else str(error)
                raise McpError(f'MCP {text}')
            return message.get('result')
        raise McpError('MCP 服务器未返回有效响应')

    async def _post(self, payload: dict[str, Any], *, expect_response: bool) -> Any:
        assert self.client is not None
        try:
            response = await self.client.post(
                self.config.url,
                json=payload,
                headers=self._post_headers(),
            )
        except httpx.HTTPError as error:
            raise McpError(f'MCP 服务器 {self.config.name} 请求失败：{error}')
        if response.status_code == 404 and self.session_id:
            # 会话已失效：清除并让上层重试
            self.session_id = None
            self._initialized = False
            raise McpError(f'MCP 服务器 {self.config.name} 会话已失效，请重试')
        if not expect_response:
            return None
        if response.status_code >= 400:
            raise McpError(f'MCP 服务器 {self.config.name} 返回 HTTP {response.status_code}')
        # 记录服务器分配的会话 ID
        sid = response.headers.get('Mcp-Session-Id')
        if sid:
            self.session_id = sid
        content_type = response.headers.get('content-type', '')
        if 'text/event-stream' in content_type:
            return self._parse_sse(response.text, payload.get('id', -1))
        try:
            message = response.json()
        except ValueError:
            raise McpError(f'MCP 服务器 {self.config.name} 返回格式无效')
        if 'error' in message:
            error = message['error']
            detail = error.get('message', '未知错误') if isinstance(error, dict) else str(error)
            raise McpError(f'MCP {self.config.name} 调用失败：{detail}')
        return message.get('result')

    async def _request(self, method: str, params: dict[str, Any]) -> Any:
        self.request_id += 1
        request_id = self.request_id
        payload = {'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params}
        return await self._post(payload, expect_response=True)

    async def _notify(self, method: str, params: dict[str, Any]) -> None:
        await self._post(
            {'jsonrpc': '2.0', 'method': method, 'params': params},
            expect_response=False,
        )

    async def call(self, method: str, params: dict[str, Any]) -> Any:
        async with self.lock:
            await self._ensure_started()
            try:
                return await self._request(method, params)
            except McpError as error:
                # 会话失效时清状态，下次重新握手
                if '会话已失效' in error.message:
                    await self.close(permanent=True)
                raise

    async def close(self, *, permanent: bool = False) -> None:
        client = self.client
        self.client = None
        self._initialized = False
        if permanent:
            self.session_id = None
            self.protocol_version = PROTOCOL_VERSION
        if client is None:
            return
        # 按规范主动终止会话（404/405 表示服务器不支持，忽略）
        if permanent and self.session_id:
            try:
                await client.delete(self.config.url, headers=self._post_headers())
            except httpx.HTTPError:
                pass
        await client.aclose()


class McpManager:
    """管理所有已启用的 MCP 服务器会话。"""

    def __init__(self) -> None:
        self._sessions: dict[str, StdioSession | HttpSession] = {}
        self._tools: list[McpTool] | None = None
        self._config_signature: str | None = None
        self._reload_lock = asyncio.Lock()

    def _current_signature(self) -> str:
        """配置内容签名：设置页保存后下次请求自动生效，不依赖文件 mtime。"""
        return json.dumps(read_config(), ensure_ascii=False, sort_keys=True)

    async def reload(self) -> None:
        """配置变动后调用：关闭旧会话并清除工具缓存（必须在事件循环内调用）。"""
        for session in list(self._sessions.values()):
            await session.close(permanent=True)
        self._sessions.clear()
        self._tools = None
        # 记录本次加载对应的配置，避免后续请求重复重载
        self._config_signature = self._current_signature()

    def _session(self, config: ServerConfig) -> StdioSession | HttpSession:
        if config.name not in self._sessions:
            self._sessions[config.name] = (
                HttpSession(config) if config.transport == 'http' else StdioSession(config)
            )
        return self._sessions[config.name]

    async def ensure_fresh(self) -> bool:
        """配置变动时自动重载会话与工具缓存；返回是否发生了重载。"""
        if self._config_signature == self._current_signature():
            return False
        async with self._reload_lock:
            # 双重检查：并发请求时只重载一次
            if self._config_signature == self._current_signature():
                return False
            await self.reload()
            return True

    async def list_tools(self) -> list[McpTool]:
        """列出所有启用服务器的工具；单个服务器失败不影响其他服务器。"""
        await self.ensure_fresh()
        if self._tools is not None:
            return self._tools
        tools: list[McpTool] = []
        for config in load_servers():
            try:
                result = await self._session(config).call('tools/list', {})
            except McpError:
                continue
            items = result.get('tools', []) if isinstance(result, dict) else []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                original = item.get('name')
                if not isinstance(original, str) or not original:
                    continue
                schema = item.get('inputSchema')
                tools.append(
                    McpTool(
                        name=f'{NAME_PREFIX}{config.name}__{original}',
                        server=config.name,
                        original_name=original,
                        description=str(item.get('description') or ''),
                        input_schema=schema if isinstance(schema, dict) else {'type': 'object', 'properties': {}},
                    )
                )
        self._tools = tools
        return tools

    async def call_tool(self, name: str, arguments: dict[str, Any] | None) -> tuple[str, bool]:
        """按带前缀的工具名调用；返回（截断后的文本, 是否为工具报错）。"""
        await self.ensure_fresh()
        if not name.startswith(NAME_PREFIX):
            raise McpError('无效的 MCP 工具名')
        # mcp__<server>__<tool> → (server, tool)
        server_name, sep, original = name[len(NAME_PREFIX) :].partition('__')
        if not sep or not server_name or not original:
            raise McpError('无效的 MCP 工具名')
        config = next((s for s in load_servers() if s.name == server_name), None)
        if config is None:
            raise McpError(f'MCP 服务器 {server_name} 未启用或不存在')
        result = await self._session(config).call(
            'tools/call', {'name': original, 'arguments': arguments or {}}
        )
        is_error = isinstance(result, dict) and result.get('isError') is True
        return _format_result(result), is_error

    async def close_all(self) -> None:
        for session in list(self._sessions.values()):
            await session.close(permanent=True)
        self._sessions.clear()
        self._tools = None


def _format_result(result: Any) -> str:
    """把 MCP 的 content 数组压成纯文本，超出预算截断。"""
    if not isinstance(result, dict):
        text = str(result)
    else:
        parts: list[str] = []
        for item in result.get('content') or []:
            if isinstance(item, dict) and item.get('type') == 'text':
                parts.append(str(item.get('text') or ''))
        text = '\n'.join(parts) if parts else json.dumps(result, ensure_ascii=False)
    return text[:MAX_RESULT_CHARS] + ('…（结果已截断）' if len(text) > MAX_RESULT_CHARS else '')


MAX_SERVERS = 20
MIN_TIMEOUT = 1.0
MAX_TIMEOUT = 300.0


def validate_config(data: Any) -> dict[str, Any]:
    """严格校验前端提交的配置，返回规范化后的 dict；不合法抛 McpError。"""
    if not isinstance(data, dict):
        raise McpError('配置格式错误：应为对象')
    raw = data.get('servers')
    if not isinstance(raw, dict):
        raise McpError('配置格式错误：servers 应为对象')
    if len(raw) > MAX_SERVERS:
        raise McpError(f'服务器数量不能超过 {MAX_SERVERS} 个')

    servers: dict[str, Any] = {}
    for name, item in raw.items():
        if not isinstance(name, str) or not name.strip():
            raise McpError('服务器名称不能为空')
        name = name.strip()
        if '__' in name:
            raise McpError(f'服务器名 {name} 不能包含双下划线（工具名分隔符）')
        if len(name) > 64:
            raise McpError(f'服务器名 {name} 过长（上限 64 字符）')
        if not isinstance(item, dict):
            raise McpError(f'服务器 {name} 的配置应为对象')

        enabled = item.get('enabled') is True
        command = item.get('command')
        url = item.get('url')
        has_command = isinstance(command, str) and command.strip()
        has_url = isinstance(url, str) and url.strip()
        if has_url:
            if not url.startswith(('http://', 'https://')):
                raise McpError(f'服务器 {name} 的 url 必须是 http(s) 地址')
            if len(url) > 2048:
                raise McpError(f'服务器 {name} 的 url 过长')
        elif has_command:
            if len(command) > 1024:
                raise McpError(f'服务器 {name} 的 command 过长')
        else:
            raise McpError(f'服务器 {name} 必须填写 command（stdio）或 url（HTTP）')

        args = item.get('args') or []
        env = item.get('env') or {}
        headers = item.get('headers') or {}
        if not isinstance(args, list) or any(not isinstance(a, str) or len(a) > 4096 for a in args):
            raise McpError(f'服务器 {name} 的 args 格式错误')
        if not isinstance(env, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in env.items()):
            raise McpError(f'服务器 {name} 的 env 格式错误')
        if not isinstance(headers, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in headers.items()):
            raise McpError(f'服务器 {name} 的 headers 格式错误')
        if len(args) > 64 or len(env) > 64 or len(headers) > 64:
            raise McpError(f'服务器 {name} 的字段数量过多')

        timeout = item.get('timeout', DEFAULT_TIMEOUT)
        try:
            timeout = float(timeout)
        except (TypeError, ValueError):
            raise McpError(f'服务器 {name} 的 timeout 必须是数字')
        if not MIN_TIMEOUT <= timeout <= MAX_TIMEOUT:
            raise McpError(f'服务器 {name} 的 timeout 需在 {MIN_TIMEOUT:g}–{MAX_TIMEOUT:g} 秒之间')

        entry: dict[str, Any] = {'enabled': enabled}
        if has_url:
            entry['url'] = url.strip()
            if headers:
                entry['headers'] = headers
        else:
            entry['command'] = command.strip()
            if args:
                entry['args'] = args
            if env:
                entry['env'] = env
        entry['timeout'] = timeout
        servers[name] = entry

    return {'servers': servers}


def read_config() -> dict[str, Any]:
    """从 chats.db 读取完整配置；无记录/损坏时返回空配置。"""
    try:
        conn = storage.connect()
        try:
            row = conn.execute('SELECT payload FROM mcp_config WHERE id = 1').fetchone()
        finally:
            conn.close()
    except Exception:
        return {'servers': {}}
    if row is None:
        return {'servers': {}}
    try:
        data = json.loads(row['payload'])
    except (ValueError, TypeError, KeyError):
        return {'servers': {}}
    if not isinstance(data, dict) or not isinstance(data.get('servers'), dict):
        return {'servers': {}}
    return {'servers': data['servers']}


def write_config(data: Any) -> dict[str, Any]:
    """校验 → 写入 chats.db（单行 UPSERT）；失败时原配置不变。"""
    normalized = validate_config(data)
    payload = json.dumps(normalized, ensure_ascii=False)
    try:
        conn = storage.connect()
        try:
            with storage.write_lock, conn:
                conn.execute(
                    'INSERT INTO mcp_config (id, payload, updated_at) VALUES (1, ?, ?) '
                    'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, '
                    'updated_at = excluded.updated_at',
                    (payload, int(time.time())),
                )
        finally:
            conn.close()
    except Exception as error:
        raise McpError(f'保存 MCP 配置失败：{error}')
    return read_config()


def migrate_legacy_config() -> bool:
    """首次启动：DB 无配置且项目根存在旧 mcp.json 时导入一次。返回是否导入。"""
    if read_config()['servers']:
        return False
    if not LEGACY_CONFIG_PATH.is_file():
        return False
    try:
        data = json.loads(LEGACY_CONFIG_PATH.read_text(encoding='utf-8'))
        validated = validate_config(data)
    except (OSError, ValueError, McpError):
        return False
    if not validated['servers']:
        return False
    write_config(validated)
    return True


manager = McpManager()
