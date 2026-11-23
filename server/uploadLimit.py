"""按路径限制模型代理的上传体积，防止超大 multipart 把服务端内存打爆。

只对 /api/deepseek/files 与 /api/deepseek/tools/asr 生效：会话保存等大请求不受影响。
同时校验 Content-Length 与逐块累计字节数，分块编码（无 Content-Length）也无法绕过。
超限返回 413 + 固定 JSON code，与代理错误格式一致。
"""

from __future__ import annotations

import logging

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import DEEPSEEK_PROXY_PREFIX

# 前端限制：附件 100MiB（attachments.ts），ASR 8MiB（speech.ts）。
# 这里留 multipart 边界与文本字段余量。
FILE_LIMIT = 110 * 1024 * 1024
ASR_LIMIT = 10 * 1024 * 1024

logger = logging.getLogger(__name__)

_LIMITS = {
    f'{DEEPSEEK_PROXY_PREFIX}/files': FILE_LIMIT,
    f'{DEEPSEEK_PROXY_PREFIX}/tools/asr': ASR_LIMIT,
}


def limit_for_path(path: str) -> int | None:
    """返回该路径的上传上限；None 表示不限制。抽出来便于测试与后续扩展。"""
    return _LIMITS.get(path.rstrip('/'))


class DeepSeekUploadLimitMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get('path', '')
        limit = limit_for_path(path) if scope['type'] == 'http' else None
        if limit is None:
            await self.app(scope, receive, send)
            return

        length = Headers(scope=scope).get('content-length')
        if length and length.isdigit() and int(length) > limit:
            await _too_large(scope, receive, send)
            return

        total = 0
        started = False

        async def receive_limited() -> Message:
            nonlocal total
            message = await receive()
            if message['type'] == 'http.request':
                total += len(message.get('body', b''))
                if total > limit:
                    raise _TooLarge()
            return message

        async def send_limited(message: Message) -> None:
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)

        try:
            await self.app(scope, receive_limited, send_limited)
        except _TooLarge:
            if started:
                # 响应头已发出，不能再发 413；记录日志并结束响应体，避免连接挂起。
                logger.warning('upload body exceeded %d bytes after response started: %s', limit, path)
                await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
            else:
                await _too_large(scope, receive, send)


class _TooLarge(Exception):
    pass


async def _too_large(scope: Scope, receive: Receive, send: Send) -> None:
    response = JSONResponse({'detail': '上传文件过大', 'code': 'UPLOAD_TOO_LARGE'}, status_code=413)
    await response(scope, receive, send)
