"""DeepSeek 模型 API 的服务端代理逻辑：Key 只存在于服务器环境（DEEPSEEK_API_KEY），浏览器不接触。

覆盖前端全部模型调用：/models 校验与列表、Anthropic 兼容 Files 上传与 messages 流式、
语音 ASR / TTS。上游统一加 Authorization: Bearer，浏览器侧不再传 x-api-key。

未配置 Key 时 raise DeepSeekError('DEEPSEEK_KEY_MISSING')，路由层转成 400 + 固定 code，
前端据此提示「服务端未配置密钥」并给部署引导，而不是当成用户输入错误。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from .config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

DEEPSEEK_KEY_MISSING = 'DEEPSEEK_KEY_MISSING'
UPSTREAM_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0)


class DeepSeekError(Exception):
    """模型代理错误：code 供前端分类，message 为可展示的说明。"""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class UpstreamResponseError(DeepSeekError):
    """上游返回了明确错误，原样透传状态码与消息给前端。"""

    def __init__(self, status: int, message: str):
        super().__init__('UPSTREAM_ERROR', message, status)


def require_key() -> str:
    if not DEEPSEEK_API_KEY:
        raise DeepSeekError(
            DEEPSEEK_KEY_MISSING,
            '服务器未配置 DEEPSEEK_API_KEY，请在 .env 中设置后重启服务。',
        )
    return DEEPSEEK_API_KEY


def auth_headers() -> dict[str, str]:
    return {
        'Authorization': f'Bearer {require_key()}',
        'Accept': 'application/json',
    }


async def get_models() -> bytes:
    """GET /models：用于 Key 校验和云端模型列表，不产生费用。"""
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        response = await client.get(f'{DEEPSEEK_BASE_URL}/models', headers=auth_headers())
    _raise_for_upstream(response)
    return response.content


async def upload_file(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    purpose: str | None,
) -> bytes:
    """POST /anthropic/v1/files：附件上传，purpose 必须为 null 时不传该字段。"""
    data: dict[str, str] = {}
    if purpose:
        data['purpose'] = purpose
    headers = {
        'Authorization': f'Bearer {require_key()}',
        'anthropic-beta': 'files-api-2025-04-14',
    }
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        response = await client.post(
            f'{DEEPSEEK_BASE_URL}/anthropic/v1/files',
            headers=headers,
            data=data,
            files={'file': (filename, file_bytes, content_type or 'application/octet-stream')},
        )
    _raise_for_upstream(response)
    return response.content


async def stream_messages(body: bytes) -> AsyncIterator[bytes]:
    """POST /anthropic/v1/messages：逐块转发上游 SSE，不做解析以免破坏事件边界。"""
    headers = {
        'Authorization': f'Bearer {require_key()}',
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'anthropic-beta': 'files-api-2025-04-14',
    }
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        async with client.stream(
            'POST',
            f'{DEEPSEEK_BASE_URL}/anthropic/v1/messages',
            headers=headers,
            content=body,
        ) as response:
            if response.status_code >= 400:
                detail = await response.aread()
                _raise_upstream(response.status_code, detail)
            async for chunk in response.aiter_bytes():
                yield chunk


async def transcribe(audio: bytes, filename: str, content_type: str) -> bytes:
    """POST /v1/tools/asr：语音识别。"""
    headers = {'Authorization': f'Bearer {require_key()}'}
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        response = await client.post(
            f'{DEEPSEEK_BASE_URL}/v1/tools/asr',
            headers=headers,
            files={'file': (filename, audio, content_type or 'audio/wav')},
        )
    _raise_for_upstream(response)
    return response.content


async def synthesize(payload: bytes) -> bytes:
    """POST /v1/tools/tts：语音合成，返回裸 PCM 字节。"""
    headers = {
        'Authorization': f'Bearer {require_key()}',
        'Content-Type': 'application/json',
    }
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        response = await client.post(
            f'{DEEPSEEK_BASE_URL}/v1/tools/tts',
            headers=headers,
            content=payload,
        )
    _raise_for_upstream(response)
    return response.content


def _raise_for_upstream(response: httpx.Response) -> None:
    if response.status_code >= 400:
        _raise_upstream(response.status_code, response.content)


def _raise_upstream(status: int, content: bytes) -> None:
    message = ''
    try:
        body = json.loads(content)
        if isinstance(body, dict):
            error = body.get('error')
            if isinstance(error, dict) and isinstance(error.get('message'), str):
                message = error['message']
            elif isinstance(body.get('detail'), str):
                message = body['detail']
    except (ValueError, UnicodeDecodeError):
        pass
    raise UpstreamResponseError(status, message or f'模型服务返回 {status}')
