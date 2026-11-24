"""会话存储：整会话保存（单事务）、详情读取、摘要列表、删除（引用计数）、重命名与置顶。

消息行 payload 保存完整消息 JSON：undefined 字段经 JSON 序列化后消失、null 保留，
读回时与写入前的结构完全一致；另提取 seq/role/created_at/parent_id 列供排序与查询。
字段名保持前端的 camelCase，不做转换层。
"""

from __future__ import annotations

import json
import sqlite3

from .core import connect, write_lock
from .search_index import apply_search_diff


def summary_from_row(row: sqlite3.Row) -> dict:
    summary: dict = {
        'id': row['id'],
        'title': row['title'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }
    if row['pinned']:
        summary['pinned'] = True
    return summary


def session_from_row(row: sqlite3.Row, messages: list[dict]) -> dict:
    session: dict = {
        'id': row['id'],
        'title': row['title'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'messages': messages,
    }
    if row['pinned']:
        session['pinned'] = True
    meta = json.loads(row['meta']) if row['meta'] else {}
    # meta 里的键是否存在区分「线性会话（undefined）」与「空会话（null）」
    if 'rootMessageId' in meta:
        session['rootMessageId'] = meta['rootMessageId']
    return session


def insert_session_row(conn: sqlite3.Connection, table: str, session: dict, upsert: bool) -> None:
    """写入会话行；upsert 为 True 时同 id 覆盖（saveSession 幂等语义），
    为 False 时保持纯 INSERT（导入暂存的重复 id 视为错误）"""
    meta: dict = {}
    if 'rootMessageId' in session:
        meta['rootMessageId'] = session['rootMessageId']
    values = (
        session['id'],
        session.get('title') or '',
        session.get('createdAt') or 0,
        session.get('updatedAt') or 0,
        1 if session.get('pinned') else 0,
        json.dumps(meta),
    )
    if upsert:
        conn.execute(
            f'INSERT INTO {table}(id, title, created_at, updated_at, pinned, meta) VALUES(?,?,?,?,?,?) '
            'ON CONFLICT(id) DO UPDATE SET title=excluded.title, created_at=excluded.created_at, '
            'updated_at=excluded.updated_at, pinned=excluded.pinned, meta=excluded.meta',
            values,
        )
    else:
        conn.execute(
            f'INSERT INTO {table}(id, title, created_at, updated_at, pinned, meta) VALUES(?,?,?,?,?,?)',
            values,
        )


def _file_mimes_and_refs(session_id: str, messages: list[dict]) -> tuple[dict[str, str], list[tuple[str, str]]]:
    """从消息 payload 提取 file_id → mimeType 与 (session_id, file_id) 引用列表。"""
    file_mimes: dict[str, str] = {}
    refs: list[tuple[str, str]] = []
    for message in messages:
        if message.get('role') != 'user':
            continue
        for file in message.get('files') or []:
            refs.append((session_id, file['id']))
            if file.get('mimeType') and file['id'] not in file_mimes:
                file_mimes[file['id']] = file['mimeType']
    return file_mimes, refs


def insert_message_rows(conn: sqlite3.Connection, table: str, session: dict) -> dict[str, str]:
    """写入消息行与附件引用行，返回 file_id → mimeType（来自消息 payload）。

    附件引用表随 table 选择：正式消息进 message_files，暂存消息进 staging_refs。
    """
    session_id = session['id']
    messages = session.get('messages') or []
    for seq, message in enumerate(messages):
        conn.execute(
            f'INSERT INTO {table}(session_id, id, seq, role, created_at, parent_id, payload) '
            'VALUES(?,?,?,?,?,?,?)',
            (
                session_id,
                message['id'],
                seq,
                message['role'],
                message.get('createdAt') or 0,
                message.get('parentId'),
                json.dumps(message),
            ),
        )
    file_mimes, refs = _file_mimes_and_refs(session_id, messages)
    ref_table = 'message_files' if table == 'messages' else 'staging_refs'
    conn.execute(f'DELETE FROM {ref_table} WHERE session_id=?', (session_id,))
    conn.executemany(f'INSERT INTO {ref_table}(session_id, file_id) VALUES(?,?)', refs)
    return file_mimes


def save_session(session: dict, files: list[tuple[str, bytes, str]] = ()) -> None:
    """整会话保存（等价前端 saveSession）：session + 消息 + 引用 + 原件单事务写入。

    files 为 (file_id, 原件字节, 声明 MIME) 列表；MIME 以消息 payload 里的 mimeType 为准，
    payload 缺失时回退到上传声明的类型（导入场景 payload 会在 file-types 步骤补齐）。

    消息做增量写入：与库中 (seq, payload) 逐条对比，只写新增/变更、删除消失的行，
    追加消息时不必整会话重写；附件引用行很小，仍全量重建最稳。
    """
    session_id = session['id']
    conn = connect()
    try:
        with write_lock, conn:
            insert_session_row(conn, 'sessions', session, upsert=True)
            messages = session.get('messages') or []
            existing = {
                row['id']: (row['seq'], row['payload'])
                for row in conn.execute(
                    'SELECT id, seq, payload FROM messages WHERE session_id=?', (session_id,)
                )
            }
            incoming_ids: set[str] = set()
            changed: list[dict] = []
            for seq, message in enumerate(messages):
                incoming_ids.add(message['id'])
                payload = json.dumps(message)
                if existing.get(message['id']) == (seq, payload):
                    continue  # 未变更
                changed.append(message)
                conn.execute(
                    'INSERT INTO messages(session_id, id, seq, role, created_at, parent_id, payload) '
                    'VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id, id) DO UPDATE SET '
                    'seq=excluded.seq, role=excluded.role, created_at=excluded.created_at, '
                    'parent_id=excluded.parent_id, payload=excluded.payload',
                    (
                        session_id,
                        message['id'],
                        seq,
                        message['role'],
                        message.get('createdAt') or 0,
                        message.get('parentId'),
                        payload,
                    ),
                )
            removed_ids = [message_id for message_id in existing if message_id not in incoming_ids]
            for message_id in removed_ids:
                conn.execute(
                    'DELETE FROM messages WHERE session_id=? AND id=?', (session_id, message_id)
                )
            file_mimes, refs = _file_mimes_and_refs(session_id, messages)
            conn.execute('DELETE FROM message_files WHERE session_id=?', (session_id,))
            conn.executemany('INSERT INTO message_files(session_id, file_id) VALUES(?,?)', refs)
            for file_id, content, content_type in files:
                mime = file_mimes.get(file_id) or content_type or ''
                conn.execute(
                    'INSERT INTO files(id, mime, size, content) VALUES(?,?,?,?) '
                    'ON CONFLICT(id) DO UPDATE SET mime=excluded.mime, size=excluded.size, content=excluded.content',
                    (file_id, mime, len(content), sqlite3.Binary(content)),
                )
            apply_search_diff(conn, session_id, changed, removed_ids)
    finally:
        conn.close()


def load_session(session_id: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
        if row is None:
            return None
        messages = [
            json.loads(item['payload'])
            for item in conn.execute(
                'SELECT payload FROM messages WHERE session_id=? ORDER BY seq', (session_id,)
            )
        ]
        return session_from_row(row, messages)
    finally:
        conn.close()


def list_summaries() -> list[dict]:
    conn = connect()
    try:
        # 只取摘要用到的列，避免把 meta（可能较大的 JSON）一并读进内存
        rows = conn.execute(
            'SELECT id, title, created_at, updated_at, pinned FROM sessions'
        ).fetchall()
        return [summary_from_row(row) for row in rows]
    finally:
        conn.close()


def delete_session(session_id: str) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            conn.execute('DELETE FROM messages_search WHERE session_id=?', (session_id,))
            conn.execute('DELETE FROM message_files WHERE session_id=?', (session_id,))
            conn.execute('DELETE FROM messages WHERE session_id=?', (session_id,))
            conn.execute('DELETE FROM favorites WHERE session_id=?', (session_id,))
            conn.execute('DELETE FROM sessions WHERE id=?', (session_id,))
            # 引用计数：已无任何会话引用的原件才删除（与前端 deleteSession 语义一致）
            conn.execute('DELETE FROM files WHERE id NOT IN (SELECT file_id FROM message_files)')
    finally:
        conn.close()


def rename_session(session_id: str, title: str) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            conn.execute('UPDATE sessions SET title=? WHERE id=?', (title, session_id))
    finally:
        conn.close()


def set_session_pinned(session_id: str, pinned: bool) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            conn.execute(
                'UPDATE sessions SET pinned=? WHERE id=?', (1 if pinned else 0, session_id)
            )
    finally:
        conn.close()
