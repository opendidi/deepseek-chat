"""请求体 pydantic 模型。"""

from __future__ import annotations

from pydantic import BaseModel


class SessionPatch(BaseModel):
    """renameSession / setSessionPinned 共用一个端点：给哪个字段就改哪个"""

    title: str | None = None
    pinned: bool | None = None


class FavoriteIn(BaseModel):
    id: str
    sessionId: str
    messageId: str
    text: str = ''
    createdAt: int = 0


class FileTypesIn(BaseModel):
    """附件 id → 字节魔数识别出的 MIME；识别不出来的写空串"""

    types: dict[str, str]
