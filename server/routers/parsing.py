"""请求解析辅助：会话 JSON 校验与 multipart 附件读取，保存与导入两个路由共用。"""

from __future__ import annotations

import json

from fastapi import HTTPException, UploadFile


def parse_session_payload(raw: str, session_id: str) -> dict:
    """解析并轻校验会话 JSON：id 必须与路径一致，消息逐条校验形状"""
    try:
        session = json.loads(raw)
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail='session 不是有效的 JSON') from error
    if not isinstance(session, dict) or session.get('id') != session_id:
        raise HTTPException(status_code=400, detail='session.id 与请求路径不一致')
    validate_messages(session)
    return session


def validate_messages(session: dict) -> None:
    """逐条校验消息形状；畸形数据返回 400 而不是让存储层 500"""
    messages = session.get('messages')
    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail='session.messages 必须是列表')
    seen: set[str] = set()
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            raise HTTPException(status_code=400, detail=f'messages[{index}] 不是对象')
        message_id = message.get('id')
        if not isinstance(message_id, str) or not message_id:
            raise HTTPException(status_code=400, detail=f'messages[{index}].id 缺失或无效')
        if message.get('role') not in ('user', 'assistant'):
            raise HTTPException(status_code=400, detail=f'messages[{index}].role 无效')
        if message_id in seen:
            raise HTTPException(status_code=400, detail=f'重复的消息 id：{message_id}')
        seen.add(message_id)


async def read_upload_files(files: list[UploadFile]) -> list[tuple[str, bytes, str]]:
    """读出全部附件字节；filename 即文件 id（前端 FormData.append 的名字）"""
    result: list[tuple[str, bytes, str]] = []
    for file in files:
        if not file.filename:
            raise HTTPException(status_code=400, detail='附件缺少文件名（文件 id）')
        result.append((file.filename, await file.read(), file.content_type or ''))
    return result
