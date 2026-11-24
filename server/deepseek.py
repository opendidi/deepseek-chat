"""DeepSeek 模型 API 的服务端代理逻辑：Key 只存在于服务器环境（DEEPSEEK_API_KEY），浏览器不接触。

覆盖前端全部模型调用：/models 校验与列表、Anthropic 兼容 Files 上传与 messages 流式、
语音 ASR / TTS。上游统一加 Authorization: Bearer，浏览器侧不再传 x-api-key。

错误分两类处理：
- 非流端点：raise DeepSeekError，路由层转成 JSON 状态码；
- 流式端点：响应头一旦发出就无法改状态码，改为 yield 一条 `event: error` SSE 帧，
  前端 client.ts 据此还原出带 status/code 的 ApiError，避免把限流/余额不足吞成通用错误。

未配置 Key 时 raise DeepSeekError('DEEPSEEK_KEY_MISSING')，路由层转成 400 + 固定 code。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from .config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

DEEPSEEK_KEY_MISSING = 'DEEPSEEK_KEY_MISSING'
UPSTREAM_ERROR = 'UPSTREAM_ERROR'
UPSTREAM_UNREACHABLE = 'UPSTREAM_UNREACHABLE'

# SSE 长连接需要较长 read 超时且有 ping 保活；其余端点应快速失败，避免占用 worker。
SSE_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0)
API_TIMEOUT = httpx.Timeout(connect=10.0, read=45.0, write=60.0, pool=10.0)

# 回显给浏览器的上游文案上限，避免超长内容或内部路径直接暴露
MAX_ERROR_MESSAGE = 500

# 共享 AsyncClient：连接池复用，避免每条消息/附件都重新做 TCP + TLS 握手。
# 惰性创建（首次请求时）；timeout 改为 per-request 传入（httpx 允许覆盖默认超时），
# 因此 SSE 长连接与普通 API 端点仍可用不同的超时配置。
_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient()
    return _client


async def close_client() -> None:
    """服务关闭时释放连接池（lifespan finally 调用）。"""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


class DeepSeekError(Exception):
    """模型代理错误：code 供前端分类，message 为可展示的说明。"""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class UpstreamResponseError(DeepSeekError):
    """上游返回了明确错误，透传状态码与消息给前端。"""

    def __init__(self, status: int, message: str, code: str = UPSTREAM_ERROR):
        super().__init__(code, message, status)


def require_key() -> str:
    if not DEEPSEEK_API_KEY:
        raise DeepSeekError(
            DEEPSEEK_KEY_MISSING,
            '服务器未配置 DEEPSEEK_API_KEY，请在 .env 中设置后重启服务。',
        )
    return DEEPSEEK_API_KEY


def auth_headers(key: str, **extra: str) -> dict[str, str]:
    """统一的鉴权头；Key 由调用方一次取出后传入，避免生成器内重复检查。"""
    return {'Authorization': f'Bearer {key}', **extra}


async def _get(path: str, headers: dict[str, str]) -> bytes:
    response = await get_client().get(
        f'{DEEPSEEK_BASE_URL}{path}', headers=headers, timeout=API_TIMEOUT
    )
    _raise_for_upstream(response)
    return response.content


async def _post(path: str, headers: dict[str, str], **kwargs) -> bytes:
    response = await get_client().post(
        f'{DEEPSEEK_BASE_URL}{path}', headers=headers, timeout=API_TIMEOUT, **kwargs
    )
    _raise_for_upstream(response)
    return response.content


async def get_models() -> bytes:
    """GET /models：用于 Key 校验和云端模型列表，不产生费用。"""
    return await _get('/models', auth_headers(require_key(), Accept='application/json'))


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
    return await _post(
        '/anthropic/v1/files',
        auth_headers(require_key(), **{'anthropic-beta': 'files-api-2025-04-14'}),
        data=data,
        files={'file': (filename, file_bytes, content_type or 'application/octet-stream')},
    )


async def stream_messages(body: bytes, key: str) -> AsyncIterator[bytes]:
    """POST /anthropic/v1/messages：逐块转发上游 SSE；错误转成 error 帧而非异常。

    生成器内的异常发生在响应头（200 + text/event-stream）已发出之后，路由层无法改状态码，
    因此这里主动把上游错误与网络异常编码成前端可识别的 SSE error 帧。
    """
    try:
        headers = auth_headers(
            key,
            **{
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'anthropic-beta': 'files-api-2025-04-14',
            }
        )
        async with get_client().stream(
            'POST',
            f'{DEEPSEEK_BASE_URL}/anthropic/v1/messages',
            headers=headers,
            content=body,
            timeout=SSE_TIMEOUT,
        ) as response:
            if response.status_code >= 400:
                detail = await response.aread()
                error = _upstream_error(response.status_code, detail)
                yield _sse_error(error)
                return
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            except (httpx.HTTPError, OSError) as error:
                yield _sse_error(
                    DeepSeekError(
                        UPSTREAM_UNREACHABLE, _network_message(error), 502
                    )
                )
    except (httpx.HTTPError, OSError) as error:
        yield _sse_error(DeepSeekError(UPSTREAM_UNREACHABLE, _network_message(error), 502))


async def transcribe(audio: bytes, filename: str, content_type: str) -> bytes:
    """POST /v1/tools/asr：语音识别。"""
    return await _post(
        '/v1/tools/asr',
        auth_headers(require_key()),
        files={'file': (filename, audio, content_type or 'audio/wav')},
    )


async def synthesize(payload: bytes) -> bytes:
    """POST /v1/tools/tts：语音合成，返回裸 PCM 字节。"""
    return await _post(
        '/v1/tools/tts',
        auth_headers(require_key(), **{'Content-Type': 'application/json'}),
        content=payload,
    )


def _network_message(error: BaseException) -> str:
    """网络异常转成可展示文案；不回显底层异常对象（可能含 URL 或内部细节）。"""
    if isinstance(error, httpx.TimeoutException):
        return '模型服务响应超时，请稍后重试。'
    return '无法连接模型服务，请检查网络或上游地址后重试。'


def _sse_error(error: DeepSeekError) -> bytes:
    """编码成前端 readServerSentEvents 能解析、client.ts 能还原 status/code 的帧。"""
    payload = json.dumps(
        {
            'error': {'message': error.message},
            'status': error.status,
            'code': error.code,
        },
        ensure_ascii=False,
    )
    return f'event: error\ndata: {payload}\n\n'.encode('utf-8')


def _raise_for_upstream(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise _upstream_error(response.status_code, response.content)


def _upstream_error(status: int, content: bytes) -> DeepSeekError:
    """解析上游错误体，提取可展示文案；兼容 error 为 dict / 字符串 / 顶层 message。"""
    message = ''
    try:
        body = json.loads(content)
        if isinstance(body, dict):
            error = body.get('error')
            if isinstance(error, dict) and isinstance(error.get('message'), str):
                message = error['message']
            elif isinstance(error, str):
                message = error
            elif isinstance(body.get('message'), str):
                message = body['message']
            elif isinstance(body.get('detail'), str):
                message = body['detail']
    except (ValueError, UnicodeDecodeError):
        pass
    if not message:
        message = f'模型服务返回 {status}'
    return UpstreamResponseError(status, message[:MAX_ERROR_MESSAGE])

