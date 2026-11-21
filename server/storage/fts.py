"""消息全文索引维护：用户提问 + 回答正文/思考。

暂无消费端点，为消息级搜索预留；随 save/delete/commit 写入时同步。
"""

from __future__ import annotations

import sqlite3


def message_text(message: dict) -> str:
    if message.get('role') == 'user':
        return message.get('content') or ''
    parts = []
    for block in message.get('blocks') or []:
        if not isinstance(block, dict):
            continue
        if block.get('type') == 'text' and block.get('text'):
            parts.append(block['text'])
        elif block.get('type') == 'thinking' and block.get('thinking'):
            parts.append(block['thinking'])
    return '\n'.join(parts)


def sync_fts(conn: sqlite3.Connection, session_id: str, messages: list[dict]) -> None:
    conn.execute('DELETE FROM messages_fts WHERE session_id=?', (session_id,))
    rows = [
        (session_id, message['id'], message_text(message))
        for message in messages
        if message_text(message)
    ]
    conn.executemany(
        'INSERT INTO messages_fts(session_id, message_id, text) VALUES(?,?,?)', rows
    )
