"""消息全文检索：在 FTS 索引表上做子串匹配（CJK 友好），返回带上下文摘录的命中。

FTS5 默认分词器不切中文词，MATCH 语法对短查询也不友好；
这里的索引表本身是普通表，直接 LIKE + ESCAPE 捕获任意子串，本机数据量下全扫毫秒级。
"""

from __future__ import annotations

from .core import connect

MAX_SNIPPET_CONTEXT = 60


def search_messages(query: str, limit: int = 30) -> list[dict]:
    """返回 {sessionId, messageId, snippet} 列表；空查询返回空列表"""
    needle = query.strip()
    if not needle:
        return []
    escaped = needle.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT session_id, message_id, text FROM messages_fts "
            "WHERE text LIKE '%' || ? || '%' ESCAPE '\\' "
            "ORDER BY length(text) LIMIT ?",
            (escaped, max(1, min(limit, 100))),
        ).fetchall()
    finally:
        conn.close()
    hits: list[dict] = []
    lower_needle = needle.lower()
    for row in rows:
        text = row['text']
        index = text.lower().find(lower_needle)
        if index < 0:
            # LIKE 的大小写折叠只对 ASCII 生效，非 ASCII 命中时 find 必然成功；防御性跳过
            continue
        start = max(0, index - 30)
        end = min(len(text), index + len(needle) + MAX_SNIPPET_CONTEXT)
        snippet = ('…' if start > 0 else '') + text[start:end] + ('…' if end < len(text) else '')
        hits.append(
            {'sessionId': row['session_id'], 'messageId': row['message_id'], 'snippet': snippet}
        )
    return hits
