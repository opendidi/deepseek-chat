"""导入暂存：会话与附件先写入 staging 表，commit 在单事务内整体替换正式数据。

语义与前端 IndexedDB 版一致：导入开始前清残留、失败后清本次写入；
commit 失败整体回滚，正式数据不变，并直接返回新摘要列表。
"""

from __future__ import annotations

import json
import sqlite3

from .core import SessionExistsError, connect, write_lock
from .search_index import sync_search_index
from .sessions import insert_message_rows, insert_session_row, summary_from_row

STAGING_TABLES = ('staging_sessions', 'staging_messages', 'staging_refs', 'staging_files')


def import_begin() -> None:
    """清空全部暂存：导入开始前清上次中断残留、失败后清本次写入"""
    conn = connect()
    try:
        with write_lock, conn:
            for table in STAGING_TABLES:
                conn.execute(f'DELETE FROM {table}')
    finally:
        conn.close()


def import_add_session(session: dict) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            try:
                insert_session_row(conn, 'staging_sessions', session, upsert=False)
            except sqlite3.IntegrityError as error:
                # 与旧版 IndexedDB add 一致：重复 id 视为导入错误
                raise SessionExistsError(session['id']) from error
            conn.execute('DELETE FROM staging_messages WHERE session_id=?', (session['id'],))
            conn.execute('DELETE FROM staging_refs WHERE session_id=?', (session['id'],))
            insert_message_rows(conn, 'staging_messages', session)
    finally:
        conn.close()


def import_put_files(files: list[tuple[str, bytes]]) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            for file_id, content in files:
                conn.execute(
                    'INSERT INTO staging_files(id, content) VALUES(?,?) '
                    'ON CONFLICT(id) DO UPDATE SET content=excluded.content',
                    (file_id, sqlite3.Binary(content)),
                )
    finally:
        conn.close()


def import_update_file_types(types: dict[str, str]) -> None:
    """回填暂存会话里附件的 mimeType（图片字节魔数识别结果；识别不出来写空串）"""
    conn = connect()
    try:
        with write_lock, conn:
            for row in conn.execute(
                'SELECT session_id, id, payload FROM staging_messages'
            ).fetchall():
                message = json.loads(row['payload'])
                if message.get('role') != 'user':
                    continue
                changed = False
                for file in message.get('files') or []:
                    new_type = types.get(file['id'], '')
                    if file.get('mimeType') != new_type:
                        file['mimeType'] = new_type
                        changed = True
                if changed:
                    conn.execute(
                        'UPDATE staging_messages SET payload=? WHERE session_id=? AND id=?',
                        (json.dumps(message), row['session_id'], row['id']),
                    )
    finally:
        conn.close()


def _staged_file_mimes(conn: sqlite3.Connection) -> dict[str, str]:
    """从暂存消息 payload 提取 file_id → mimeType（file-types 步骤已回填）"""
    file_mimes: dict[str, str] = {}
    for row in conn.execute('SELECT payload FROM staging_messages').fetchall():
        message = json.loads(row['payload'])
        if message.get('role') != 'user':
            continue
        for file in message.get('files') or []:
            if file.get('mimeType') and file['id'] not in file_mimes:
                file_mimes[file['id']] = file['mimeType']
    return file_mimes


def import_commit() -> list[dict]:
    """单事务整体替换：正式数据清空 → 暂存移入 → 收藏清空 → 暂存清空，返回新摘要列表"""
    conn = connect()
    try:
        with write_lock, conn:
            summaries: list[dict] = []
            conn.execute('DELETE FROM messages_search')
            conn.execute('DELETE FROM message_files')
            conn.execute('DELETE FROM messages')
            conn.execute('DELETE FROM sessions')
            conn.execute('DELETE FROM files')
            conn.execute('DELETE FROM favorites')
            for row in conn.execute('SELECT * FROM staging_sessions ORDER BY rowid').fetchall():
                conn.execute(
                    'INSERT INTO sessions(id, title, created_at, updated_at, pinned, meta) '
                    'VALUES(?,?,?,?,?,?)',
                    (
                        row['id'],
                        row['title'],
                        row['created_at'],
                        row['updated_at'],
                        row['pinned'],
                        row['meta'],
                    ),
                )
                summaries.append(summary_from_row(row))
            for row in conn.execute(
                'SELECT * FROM staging_messages ORDER BY session_id, seq'
            ).fetchall():
                conn.execute(
                    'INSERT INTO messages(session_id, id, seq, role, created_at, parent_id, payload) '
                    'VALUES(?,?,?,?,?,?,?)',
                    (
                        row['session_id'],
                        row['id'],
                        row['seq'],
                        row['role'],
                        row['created_at'],
                        row['parent_id'],
                        row['payload'],
                    ),
                )
            conn.executemany(
                'INSERT INTO message_files(session_id, file_id) VALUES(?,?)',
                [(row['session_id'], row['file_id']) for row in conn.execute('SELECT * FROM staging_refs')],
            )
            file_mimes = _staged_file_mimes(conn)
            for row in conn.execute('SELECT * FROM staging_files').fetchall():
                conn.execute(
                    'INSERT INTO files(id, mime, size, content) VALUES(?,?,?,?)',
                    (row['id'], file_mimes.get(row['id'], ''), len(row['content']), row['content']),
                )
            for summary in summaries:
                messages = [
                    json.loads(item['payload'])
                    for item in conn.execute(
                        'SELECT payload FROM staging_messages WHERE session_id=? ORDER BY seq',
                        (summary['id'],),
                    )
                ]
                sync_search_index(conn, summary['id'], messages)
            for table in STAGING_TABLES:
                conn.execute(f'DELETE FROM {table}')
            return summaries
    finally:
        conn.close()
