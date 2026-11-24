"""存储层语义测试：与前端 tests/db.test.ts（fake-indexeddb 版）的断言逐条对应。

覆盖四个最容易出数据事故的事务：
1. save_session 的会话+消息+附件原子写入与读回一致性；
2. rename/pin 同步；
3. delete_session 的附件引用计数清理与收藏级联；
4. import_commit 的整体替换（旧会话删除、收藏清空、暂存清空、返回摘要）。
"""

from __future__ import annotations

import json
import sqlite3

import pytest

from server import storage
from server.storage import core


@pytest.fixture()
def db(tmp_path):
    storage.configure(tmp_path)
    return storage


def user(message_id: str, content: str = 'question', files: list | None = None, **extra) -> dict:
    message = {
        'id': message_id,
        'role': 'user',
        'content': content,
        'files': files if files is not None else [],
        'createdAt': 1_000,
    }
    message.update(extra)
    return message


def reply(message_id: str, text: str = 'answer', **extra) -> dict:
    message = {
        'id': message_id,
        'role': 'assistant',
        'createdAt': 1_100,
        'model': None,
        'prefix': False,
        'status': 'done',
        'blocks': [{'type': 'text', 'text': text}],
    }
    message.update(extra)
    return message


def session(session_id: str, messages: list[dict], **extra) -> dict:
    data = {
        'id': session_id,
        'title': f'title-{session_id}',
        'createdAt': 1_000,
        'updatedAt': 2_000,
        'messages': messages,
    }
    data.update(extra)
    return data


def test_save_and_load_roundtrip(db):
    """saveSession 写入会话、消息与附件，loadSession 读回一致；摘要不携带消息"""
    original = session(
        's1',
        [user('u1'), reply('a1')],
        rootMessageId='u1',
    )
    db.save_session(original, [('f1', b'blob-f1', 'image/png')])

    loaded = db.load_session('s1')
    assert loaded == original

    summaries = db.list_summaries()
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary['id'] == 's1'
    assert summary['title'] == 'title-s1'
    # 本会话未置顶：摘要不携带 pinned（可选字段语义）
    assert 'pinned' not in summary
    assert 'messages' not in summary

    mime, content = db.load_file('f1')
    assert mime == 'image/png'
    assert content == b'blob-f1'

    # 未保存过 rootMessageId 的线性会话读回时没有该键（undefined 语义）
    linear = db.load_session('s1')
    assert 'rootMessageId' in linear

    empty = session('s2', [], rootMessageId=None)
    db.save_session(empty)
    loaded_empty = db.load_session('s2')
    assert loaded_empty['messages'] == []
    assert loaded_empty['rootMessageId'] is None


def test_save_same_session_twice_overwrites(db):
    """saveSession 幂等：重复保存同一会话（同一批消息 + 新增消息）按 upsert 覆盖，不报主键冲突"""
    db.save_session(session('s1', [user('u1'), reply('a1')]))
    again = session(
        's1',
        [user('u1'), reply('a1'), user('u2', content='第二个问题'), reply('a2')],
        title='更新过的标题',
    )
    db.save_session(again)

    loaded = db.load_session('s1')
    assert loaded == again
    summaries = db.list_summaries()
    assert len(summaries) == 1
    assert summaries[0]['title'] == '更新过的标题'


def test_rename_and_pinned_sync(db):
    """rename/pin 同步生效；取消置顶后摘要不再携带 pinned"""
    db.save_session(session('s1', [user('u1'), reply('a1')]))

    db.rename_session('s1', 'renamed')
    assert db.load_session('s1')['title'] == 'renamed'
    assert db.list_summaries()[0]['title'] == 'renamed'

    db.set_session_pinned('s1', True)
    assert db.list_summaries()[0]['pinned'] is True
    db.set_session_pinned('s1', False)
    assert 'pinned' not in db.list_summaries()[0]

    # 不存在的会话：静默无操作（与前端「读不到就跳过」一致）
    db.rename_session('missing', 'x')
    db.set_session_pinned('missing', True)


def test_delete_reference_counting(db):
    """删除会话只清理无引用的附件原件；收藏随会话级联删除"""
    shared_file = {
        'id': 'shared-file',
        'serverId': None,
        'name': 'a.png',
        'size': 3,
        'isImage': True,
        'mimeType': 'image/png',
    }
    shared_user = user('u1', files=[shared_file])
    db.save_session(session('del-a', [shared_user, reply('a1')]), [('shared-file', b'data', 'image/png')])
    db.save_session(session('del-b', [shared_user, reply('a1')]))
    db.put_favorite({'id': 'del-a:a1', 'sessionId': 'del-a', 'messageId': 'a1', 'text': 'x', 'createdAt': 5})

    db.delete_session('del-a')
    assert db.load_session('del-a') is None
    # 仍被 del-b 引用，原件保留
    assert db.load_file('shared-file') is not None
    assert [item['id'] for item in db.list_favorites()] == []

    db.delete_session('del-b')
    # 已无任何会话引用，原件清理
    assert db.load_file('shared-file') is None

    # 收藏随所属会话一起删除
    db.save_session(session('del-x', [user('u1'), reply('a1')]))
    db.put_favorite({'id': 'del-x:a1', 'sessionId': 'del-x', 'messageId': 'a1', 'text': 'x', 'createdAt': 6})
    db.delete_session('del-x')
    assert db.list_favorites() == []


def test_import_commit_replaces_everything(db):
    """导入暂存整体替换：旧会话删除、收藏清空、暂存清空、返回摘要列表"""
    db.save_session(session('old', [user('u1'), reply('a1')]))
    db.put_favorite({'id': 'old:a1', 'sessionId': 'old', 'messageId': 'a1', 'text': 'old', 'createdAt': 6})

    db.import_begin()
    new_session = session(
        'new',
        [
            user('u2', files=[{'id': 'new-file', 'serverId': None, 'name': 'a.png', 'size': 4, 'isImage': True, 'mimeType': ''}]),
            reply('a2'),
        ],
    )
    db.import_add_session(new_session)
    db.import_put_files([('new-file', b'data')])
    # 图片字节识别结果回填 MIME
    db.import_update_file_types({'new-file': 'image/png'})

    summaries = db.import_commit()
    assert [item['id'] for item in summaries] == ['new']
    assert db.load_session('old') is None
    loaded = db.load_session('new')
    assert loaded['messages'][0]['files'][0]['mimeType'] == 'image/png'
    mime, content = db.load_file('new-file')
    assert (mime, content) == ('image/png', b'data')
    # 收藏随整体替换清空
    assert db.list_favorites() == []
    # 再 begin 只清暂存，不动正式数据
    db.import_begin()
    assert [item['id'] for item in db.list_summaries()] == ['new']


def test_import_duplicate_session_rejected(db):
    db.import_begin()
    db.import_add_session(session('dup', [user('u1')]))
    with pytest.raises(storage.SessionExistsError):
        db.import_add_session(session('dup', [user('u1')]))


def test_search_index_is_plain_table(db):
    """消息搜索索引是普通表（LIKE 子串匹配），不是 fts5 虚拟表"""
    conn = sqlite3.connect(core._db_path)
    try:
        row = conn.execute("SELECT type FROM sqlite_master WHERE name='messages_search'").fetchone()
        assert row is not None and row[0] == 'table'
        # 旧 fts5 表已退役
        assert (
            conn.execute("SELECT count(*) FROM sqlite_master WHERE name='messages_fts'").fetchone()[0]
            == 0
        )
    finally:
        conn.close()


def test_search_index_maintenance(db):
    """消息搜索索引随保存/删除维护；删除会话时级联清理其索引行"""
    db.save_session(session('s1', [user('u1', content='查找这段'), reply('a1', text='答案正文')]))
    db.save_session(session('s2', [user('u1', content='另一段')]))
    conn = sqlite3.connect(core._db_path)
    try:
        assert conn.execute('SELECT count(*) FROM messages_search').fetchone()[0] == 3
    finally:
        conn.close()
    db.delete_session('s1')
    conn = sqlite3.connect(core._db_path)
    try:
        remaining = conn.execute('SELECT session_id FROM messages_search').fetchall()
        assert {row[0] for row in remaining} == {'s2'}
    finally:
        conn.close()


def test_search_messages_returns_hits(db):
    """消息级搜索命中用户提问与回答正文，返回带上下文摘录的结果"""
    db.save_session(session('s1', [user('u1', content='如何部署到服务器'), reply('a1', text='用 systemd + nginx')]))
    hits = db.search_messages('部署')
    assert [hit['sessionId'] for hit in hits] == ['s1']
    assert '部署' in hits[0]['snippet']


def test_migration_v2_drops_fts_and_backfills(tmp_path):
    """旧库（v2，含 fts5 messages_fts）启动迁移后：fts 表删除，普通索引表建好并回填历史"""
    db_path = tmp_path / 'chats.db'
    conn = sqlite3.connect(db_path)
    conn.execute(
        'CREATE TABLE messages ('
        'session_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, '
        'role TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, '
        'parent_id TEXT, payload TEXT NOT NULL, PRIMARY KEY (session_id, id))'
    )
    conn.execute(
        'CREATE VIRTUAL TABLE messages_fts USING fts5(text, session_id UNINDEXED, message_id UNINDEXED)'
    )
    conn.execute(
        "INSERT INTO messages(session_id, id, seq, role, created_at, payload) "
        "VALUES('s1', 'u1', 0, 'user', 1, ?)",
        (json.dumps({'id': 'u1', 'role': 'user', 'content': '旧内容'}),),
    )
    conn.execute('PRAGMA user_version = 2')
    conn.commit()
    conn.close()

    storage.configure(tmp_path)

    conn = sqlite3.connect(db_path)
    try:
        assert (
            conn.execute("SELECT count(*) FROM sqlite_master WHERE name='messages_fts'").fetchone()[0]
            == 0
        )
        assert conn.execute("SELECT text FROM messages_search WHERE message_id='u1'").fetchone()[0] == '旧内容'
        assert conn.execute('PRAGMA user_version').fetchone()[0] == core.SCHEMA_VERSION
    finally:
        conn.close()


def test_missing_reads(db):
    """读不存在的会话/附件返回 None（前端映射为 undefined）"""
    assert db.load_session('nope') is None
    assert db.load_file('nope') is None
    assert db.list_summaries() == []


def test_append_does_not_rewrite_unchanged_rows(db):
    """增量保存：追加消息时，未变更的消息行保留原 rowid（即未 delete + 重插）。

    s1 之后再加一个会话把 rowid 水位抬高：否则整会话重写删空本会话后 rowid 会被复用，
    恰好掩盖掉「delete + 重插」的行为。
    """
    db.save_session(session('other', [user('ox'), reply('oy')]))
    db.save_session(session('s1', [user('u1'), reply('a1')]))
    db.save_session(session('other2', [user('zx'), reply('zy')]))
    conn = sqlite3.connect(core._db_path)
    try:
        before = dict(conn.execute('SELECT id, rowid FROM messages WHERE session_id=?', ('s1',)))
    finally:
        conn.close()

    db.save_session(session('s1', [user('u1'), reply('a1'), user('u2', content='第二个问题'), reply('a2')]))

    conn = sqlite3.connect(core._db_path)
    try:
        after = dict(conn.execute('SELECT id, rowid FROM messages WHERE session_id=?', ('s1',)))
    finally:
        conn.close()
    assert after['u1'] == before['u1']
    assert after['a1'] == before['a1']
    assert {'u1', 'a1', 'u2', 'a2'} <= after.keys()


def test_edit_and_delete_messages(db):
    """增量保存：编辑消息内容、删除中间消息后读回一致"""
    db.save_session(session('s1', [user('u1', content='v1'), reply('a1', text='t1'), reply('a2', text='t2')]))
    # 编辑 u1 内容、删除 a1
    edited = session('s1', [user('u1', content='v2'), reply('a2', text='t2')])
    db.save_session(edited)
    assert db.load_session('s1') == edited


def test_reorder_updates_seq(db):
    """增量保存：消息重排后按 seq 读回新顺序（seq 列随位置更新）"""
    db.save_session(session('s1', [user('u1'), reply('a1'), user('u2')]))
    reordered = session('s1', [user('u1'), user('u2'), reply('a1')])
    db.save_session(reordered)
    loaded = db.load_session('s1')
    assert [message['id'] for message in loaded['messages']] == ['u1', 'u2', 'a1']
