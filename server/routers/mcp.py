"""MCP 工具与配置路由。

安全边界：
- 只有配置里显式 enabled=true 的服务器才被连接；
- 配置写接口（PUT /config）可让服务端执行任意命令，因此要求：
  1) 设置了 ACCESS_PASSWORD 时走全局口令中间件（已鉴权）；
  2) 未设置口令时，只允许本机回环直连写入，挡住公网远程命令执行；
- 工具结果在客户端统一截断，避免把大对象塞进模型上下文；
- 单个服务器失败不影响其他服务器，也不影响应用启动。
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from ..mcp_client import (
    McpError,
    load_servers,
    manager,
    read_config,
    validate_config,
    write_config,
)

router = APIRouter(prefix='/api/mcp', tags=['mcp'])

LOOPBACK_PEERS = frozenset({'127.0.0.1', '::1', 'testclient'})


def _is_loopback(request: Request) -> bool:
    """判断是否本机直连：反代场景下的 X-Forwarded-For 不采信（可伪造）。"""
    peer = request.client.host if request.client else ''
    if peer not in LOOPBACK_PEERS:
        return False
    return not request.headers.get('x-forwarded-for')


def _config_write_allowed(request: Request) -> bool:
    # 全局口令中间件已对 /api/* 校验 x-access-key；这里只需区分是否启用了口令
    return bool(os.environ.get('ACCESS_PASSWORD')) or _is_loopback(request)


@router.get('/status')
async def status() -> dict:
    """供设置页显示：有无配置、启用了几个服务器。"""
    await manager.ensure_fresh()
    servers = load_servers()
    return {
        'configured': len(servers) > 0,
        'servers': [server.name for server in servers],
    }


@router.get('/config')
async def get_config(request: Request) -> Response:
    """读取完整配置（含未启用的服务器），供设置页编辑。"""
    can_write = _config_write_allowed(request)
    return JSONResponse({
        **read_config(),
        'canWrite': can_write,
        'reason': None if can_write else 'REMOTE_WRITE_BLOCKED',
    })


@router.put('/config')
async def put_config(request: Request) -> Response:
    if not _config_write_allowed(request):
        return JSONResponse(
            {
                'detail': '未设置 ACCESS_PASSWORD 时，仅允许在本机修改 MCP 配置',
                'code': 'MCP_WRITE_FORBIDDEN',
            },
            status_code=403,
        )
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({'detail': '请求体不是合法 JSON', 'code': 'BAD_REQUEST'}, status_code=400)
    try:
        validated = validate_config(body)
    except McpError as error:
        return JSONResponse({'detail': error.message, 'code': 'MCP_CONFIG_INVALID'}, status_code=400)
    try:
        saved = write_config(validated)
    except McpError as error:
        return JSONResponse({'detail': error.message, 'code': 'MCP_WRITE_FAILED'}, status_code=500)
    # 写入后立即关闭旧会话并清空工具缓存，让新配置立刻生效
    await manager.reload()
    return JSONResponse({'ok': True, 'config': saved})


@router.get('/tools')
async def tools() -> Response:
    """返回 MCP 工具声明，供前端并入模型请求的 tools 数组。"""
    await manager.ensure_fresh()
    if not load_servers():
        return JSONResponse([])
    try:
        items = await manager.list_tools()
    except McpError as error:
        return JSONResponse({'detail': error.message, 'code': 'MCP_ERROR'}, status_code=502)
    return JSONResponse([
        {
            'name': tool.name,
            'description': tool.description,
            'input_schema': tool.input_schema,
        }
        for tool in items
    ])


@router.post('/call')
async def call(request: Request) -> Response:
    await manager.ensure_fresh()
    body = await request.json()
    if not isinstance(body, dict):
        return JSONResponse({'detail': '请求体格式错误', 'code': 'BAD_REQUEST'}, status_code=400)
    name = body.get('name')
    arguments = body.get('arguments') or {}
    if not isinstance(name, str) or not isinstance(arguments, dict):
        return JSONResponse({'detail': 'name/arguments 格式错误', 'code': 'BAD_REQUEST'}, status_code=400)
    try:
        result, is_error = await manager.call_tool(name, arguments)
    except McpError as error:
        return JSONResponse({'detail': error.message, 'code': 'MCP_ERROR'}, status_code=502)
    return JSONResponse({'content': result, 'isError': is_error})


@router.post('/reload')
async def reload_config() -> dict:
    """手动重载配置（设置页刷新按钮调用）。"""
    await manager.reload()
    return {'ok': True, 'servers': [server.name for server in load_servers()]}
