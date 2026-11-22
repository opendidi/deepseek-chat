"""请求体 pydantic 模型。

字段类型用 Optional 而非 `X | None`：模型注解会被 pydantic 运行时求值，
3.9 解释器（Bullseye / 部分开发板镜像）不支持 PEP 604 的运行时写法；
`from __future__ import annotations` 只让它变成字符串，绕不开求值这一步。
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SessionPatch(BaseModel):
    """renameSession / setSessionPinned 共用一个端点：给哪个字段就改哪个"""

    title: Optional[str] = None
    pinned: Optional[bool] = None


class FavoriteIn(BaseModel):
    id: str
    sessionId: str
    messageId: str
    text: str = ''
    createdAt: int = 0


class FileTypesIn(BaseModel):
    """附件 id → 字节魔数识别出的 MIME；识别不出来的写空串"""

    types: dict[str, str]
