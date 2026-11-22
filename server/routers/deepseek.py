"""DeepSeek 模型 API 代理路由：浏览器无需持有 Key，全部模型调用经这里转发。

端点与前端 apiOrigin 直连时一一对应：
- GET  /api/deepseek/models              模型列表 / Key 连通性校验
- POST /api/deepseek/files               附件上传
- POST /api/deepseek/messages            messages 流式（SSE 逐块透传）
- POST /api/deepseek/tools/asr           语音识别
- POST /api/deepseek/tools/tts           语音合成（裸 PCM）

错误码固定：DEEPSEEK_KEY_MISSING 表示服务端没配 Key；UPSTREAM_ERROR 透传上游状态码。
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..deepseek import (
    DeepSeekError,
    get_models,
    require_key,
    stream_messages,
    synthesize,
    transcribe,
    upload_file,
)

router = APIRouter(prefix='/api/deepseek', tags=['deepseek'])


def _error_response(error: DeepSeekError) -> JSONResponse:
    return JSONResponse(
        {'detail': error.message, 'code': error.code},
        status_code=error.status,
    )


@router.get('/models')
async def models() -> Response:
    try:
        return Response(content=await get_models(), media_type='application/json')
    except DeepSeekError as error:
        return _error_response(error)


@router.post('/files')
async def files(request: Request) -> Response:
    try:
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
    except DeepSeekError as error:
        return _error_response(error)


@router.post('/messages')
async def messages(request: Request) -> Response:
    try:
        # 生成器内的错误在迭代时才抛出，路由层抓不到；先在这里检查 Key
        require_key()
        body = await request.body()
        return StreamingResponse(
            stream_messages(body),
            media_type='text/event-stream',
            headers={
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        )
    except DeepSeekError as error:
        return _error_response(error)


@router.post('/tools/asr')
async def asr(request: Request) -> Response:
    try:
        form = await request.form()
        upload = form.get('file')
        if not upload or not hasattr(upload, 'read'):
            return JSONResponse({'detail': '缺少 file 字段', 'code': 'BAD_REQUEST'}, status_code=400)
        raw = await upload.read()
        return Response(
            content=await transcribe(
                raw,
                upload.filename or 'recording.wav',
                upload.content_type or 'audio/wav',
            ),
            media_type='application/json',
        )
    except DeepSeekError as error:
        return _error_response(error)


@router.post('/tools/tts')
async def tts(request: Request) -> Response:
    try:
        body = await request.body()
        return Response(content=await synthesize(body), media_type='audio/pcm')
    except DeepSeekError as error:
        return _error_response(error)
