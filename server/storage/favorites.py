"""跨会话收藏：id 形如 `{sessionId}:{messageId}`，一条回答只收藏一份。"""

from __future__ import annotations

from .core import connect, write_lock


def list_favorites() -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute('SELECT * FROM favorites ORDER BY created_at DESC').fetchall()
        return [
            {
                'id': row['id'],
                'sessionId': row['session_id'],
                'messageId': row['message_id'],
                'text': row['text'],
                'createdAt': row['created_at'],
            }
            for row in rows
        ]
    finally:
        conn.close()


def put_favorite(favorite: dict) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            conn.execute(
                'INSERT INTO favorites(id, session_id, message_id, text, created_at) VALUES(?,?,?,?,?) '
                'ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id, message_id=excluded.message_id, '
                'text=excluded.text, created_at=excluded.created_at',
                (
                    favorite['id'],
                    favorite['sessionId'],
                    favorite['messageId'],
                    favorite.get('text') or '',
                    favorite.get('createdAt') or 0,
                ),
            )
    finally:
        conn.close()


def delete_favorite(favorite_id: str) -> None:
    conn = connect()
    try:
        with write_lock, conn:
            conn.execute('DELETE FROM favorites WHERE id=?', (favorite_id,))
    finally:
        conn.close()
