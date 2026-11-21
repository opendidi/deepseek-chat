"""存储层公共设施：数据库文件位置、schema 初始化、连接获取。"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

# 服务端只做轻量校验：形状深校验仍由前端完成（与 IndexedDB 直接存 JSON 的旧行为一致）


class SessionExistsError(Exception):
    """导入暂存里已存在同 id 会话（旧版 IndexedDB add 的重复键语义）"""


# SQLite 是单写者模型：并发写事务超过 busy timeout（Python 默认 5s）会抛 database is locked。
# 本机单用户写吞吐不是瓶颈，应用层一把全局写锁串行化所有写事务最稳妥；读走 WAL 快照不参与加锁。
write_lock = threading.Lock()


_db_path: Path | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, seq);
CREATE TABLE IF NOT EXISTS message_files (
  session_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  PRIMARY KEY (session_id, file_id)
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  content BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
-- 导入暂存：与正式表镜像；导入过程中只写这里，commit 在单事务内整体替换
CREATE TABLE IF NOT EXISTS staging_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS staging_messages (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE TABLE IF NOT EXISTS staging_refs (
  session_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  PRIMARY KEY (session_id, file_id)
);
CREATE TABLE IF NOT EXISTS staging_files (
  id TEXT PRIMARY KEY,
  content BLOB NOT NULL
);
-- 消息全文索引（用户提问 + 回答正文/思考），随写入维护；暂无消费端点，为消息级搜索预留
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  session_id UNINDEXED,
  message_id UNINDEXED
);
"""


def configure(data_dir: Path) -> None:
    """设置数据目录并确保 schema 存在；应用启动与测试前调用"""
    global _db_path
    data_dir.mkdir(parents=True, exist_ok=True)
    _db_path = data_dir / 'chats.db'
    conn = connect()
    try:
        with conn:
            conn.executescript(SCHEMA)
    finally:
        conn.close()


def connect() -> sqlite3.Connection:
    if _db_path is None:
        raise RuntimeError('storage.configure() 尚未调用')
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    # WAL：读写互不阻塞；本地单用户场景足够，进程外访问同一文件时也安全
    conn.execute('PRAGMA journal_mode=WAL')
    return conn
