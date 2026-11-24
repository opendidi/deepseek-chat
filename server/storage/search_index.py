"""消息级搜索索引维护：把用户提问 + 回答正文/思考的纯文本写入普通表 messages_search。

搜索（storage/search.py）用 LIKE 子串匹配——前导通配符（%词%）走不了索引，本地数据量下
全扫毫秒级，因此索引表是普通表而非 fts5 虚拟表，省掉虚拟表那一层维护开销。
随 save / delete / import commit 写入时同步。
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


def sync_search_index(conn: sqlite3.Connection, session_id: str, messages: list[dict]) -> None:
    """整会话重建索引（导入整体替换用）：先清空该会话再全量写入。"""
    conn.execute('DELETE FROM messages_search WHERE session_id=?', (session_id,))
    rows = [
        (session_id, message['id'], message_text(message))
        for message in messages
        if message_text(message)
    ]
    conn.executemany(
        'INSERT INTO messages_search(session_id, message_id, text) VALUES(?,?,?)', rows
    )


def _upsert_row(conn: sqlite3.Connection, session_id: str, message: dict) -> None:
    """按当前文本重写单条索引行；文本为空时只删不插。"""
    text = message_text(message)
    conn.execute(
        'DELETE FROM messages_search WHERE session_id=? AND message_id=?',
        (session_id, message['id']),
    )
    if text:
        conn.execute(
            'INSERT INTO messages_search(session_id, message_id, text) VALUES(?,?,?)',
            (session_id, message['id'], text),
        )


def apply_search_diff(
    conn: sqlite3.Connection,
    session_id: str,
    upsert_messages: list[dict],
    remove_ids: list[str],
) -> None:
    """增量维护（save_session 用）：变更的消息重写其索引行，删除的消息移除其索引行。"""
    for message in upsert_messages:
        _upsert_row(conn, session_id, message)
    for message_id in remove_ids:
        conn.execute(
            'DELETE FROM messages_search WHERE session_id=? AND message_id=?',
            (session_id, message_id),
        )
