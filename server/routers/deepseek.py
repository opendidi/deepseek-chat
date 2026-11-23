"""DeepSeek 模型 API 代理路由：浏览器无需持有 Key，全部模型调用经这里转发。

端点与上游直连时一一对应：
- GET  /api/deepseek/models              模型列表 / Key 连通性校验
- POST /api/deepseek/files               附件上传
- POST /api/deepseek/messages            messages 流式（SSE 逐块透传）
- POST /api/deepseek/tools/asr           语音识别
- POST /api/deepseek/tools/tts           语音合成（裸 PCM）

错误码固定：DEEPSEEK_KEY_MISSING 表示服务端没配 Key；UPSTREAM_ERROR 透传上游状态码。
"""

from __future__ import annotations

import functools

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..config import DEEPSEEK_PROXY_PREFIX
from ..deepseek import (
    UPSTREAM_UNREACHABLE,
    DeepSeekError,
    get_models,
    require_key,
    stream_messages,
    synthesize,
    transcribe,
    upload_file,
)

router = APIRouter(prefix=DEEPSEEK_PROXY_PREFIX, tags=['deepseek'])


def _error_response(error: DeepSeekError) -> JSONResponse:
    """上游错误带专用头：前端据此区分「模型 Key 失效」与「本机访问口令失效」。"""
    return JSONResponse(
        {'detail': error.message, 'code': error.code},
        status_code=error.status,
        headers={'x-proxy-error': 'upstream'},
    )


def _guard_upstream(func):
    """把 httpx 网络异常转成友好错误；DeepSeekError 与正常响应原样放行。"""

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except DeepSeekError as error:
            return _error_response(error)
        except httpx.TimeoutException:
            return _error_response(
                DeepSeekError(UPSTREAM_UNREACHABLE, '模型服务响应超时，请稍后重试。', 504)
            )
        except (httpx.HTTPError, OSError):
            return _error_response(
                DeepSeekError(UPSTREAM_UNREACHABLE, '无法连接模型服务，请检查网络或上游地址。', 502)
            )

    return wrapper


@router.get('/models')
@_guard_upstream
async def models() -> Response:
    return Response(content=await get_models(), media_type='application/json')


@router.post('/files')
@_guard_upstream
async def files(request: Request) -> Response:
    form = await request.form()
    upload = form.get('file')
    if not upload or not hasattr(upload, 'read'):
        return JSONResponse({'detail': '缺少 file 字段', 'code': 'BAD_REQUEST'}, status_code=400)
    raw = await upload.read()
    purpose = form.get('purpose')
    return Response(
        content=await upload_file(
            raw,
            upload.filename or 'file',
            upload.content_type or 'application/octet-stream',
            purpose if isinstance(purpose, str) else None,
        ),
        media_type='application/json',
    )


@router.post('/messages')
@_guard_upstream
async def messages(request: Request) -> Response:
    # 只在这里检查一次 Key：缺 Key 时以 400 JSON 返回（响应头发出后就无法改状态码），
    # 生成器只负责把上游错误与网络异常编码成 SSE error 帧。
    key = require_key()
    body = await request.body()
    return StreamingResponse(
        stream_messages(body, key),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'},
    )


@router.post('/tools/asr')
@_guard_upstream
async def asr(request: Request) -> Response:
    form = await request.form()
    upload = form.get('file')
    if not upload or not hasattr(upload, 'read'):
        return JSONResponse({'detail': '缺少 file 字段', 'code': 'BAD_REQUEST'}, status_code=400)
    raw = await upload.read()
    return Response(
        content=await transcribe(raw, upload.filename or 'recording.wav', upload.content_type or 'audio/wav'),
        media_type='application/json',
    )


@router.post('/tools/tts')
@_guard_upstream
async def tts(request: Request) -> Response:
    body = await request.body()
    return Response(content=await synthesize(body), media_type='audio/pcm')
