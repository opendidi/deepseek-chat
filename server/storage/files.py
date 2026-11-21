"""附件原件存储：Blob 存进 files 表的 BLOB 列，按附件本地 id 检索。"""

from __future__ import annotations

from .core import connect


def load_file(file_id: str) -> tuple[str, bytes] | None:
    """返回 (mime, 原件字节)；本地没有原件时为 None（前端只展示文件名，不进请求）"""
    conn = connect()
    try:
        row = conn.execute('SELECT mime, content FROM files WHERE id=?', (file_id,)).fetchone()
        if row is None:
            return None
        return row['mime'], row['content']
    finally:
        conn.close()
