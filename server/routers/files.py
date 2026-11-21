"""附件原件路由：按本地 id 读取 Blob，供缩略图、灯箱与下载使用。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..storage import load_file

router = APIRouter(prefix='/api/files', tags=['files'])


@router.get('/{file_id}')
def get_file(file_id: str) -> Response:
    stored = load_file(file_id)
    if stored is None:
        raise HTTPException(status_code=404, detail='原件不存在')
    mime, content = stored
    safe_mime = mime or 'application/octet-stream'
    headers = {
        # 附件 id 内容不变，允许浏览器缓存；objectURL 链路不受影响
        'Cache-Control': 'private, max-age=86400',
        # MIME 来自上传内容（用户可控），禁止浏览器嗅探改写
        'X-Content-Type-Options': 'nosniff',
    }
    # 只允许位图类 MIME 内联展示；svg 可携带脚本、其余类型一律强制下载，
    # 避免「直接打开附件 URL」时在应用同源执行任意脚本
    inline = safe_mime.startswith('image/') and safe_mime != 'image/svg+xml'
    if not inline:
        headers['Content-Disposition'] = 'attachment'
    return Response(content=content, media_type=safe_mime, headers=headers)
