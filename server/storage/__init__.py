"""SQLite 存储层公共出口。

数据语义与前端 IndexedDB 版本一一对应（见 src/services/chat/db.ts 的函数注释）：
- save_session：会话、消息、附件引用与原件在单事务内写入，全部成功或全部回滚；
- delete_session：删除会话并级联清理收藏，附件原件按引用计数清理（仍被其他会话引用的保留）；
- import_commit：导入暂存在单事务内整体替换正式数据，失败整体回滚，返回新摘要列表。

按领域拆分：core（连接与 schema）、sessions（会话）、files（附件原件）、
favorites（收藏）、staging（导入暂存）、fts（消息全文索引维护）。
"""

from .core import SessionExistsError, configure
from .favorites import delete_favorite, list_favorites, put_favorite
from .files import load_file
from .search import search_messages
from .sessions import (
    delete_session,
    list_summaries,
    load_session,
    rename_session,
    save_session,
    set_session_pinned,
)
from .staging import (
    import_add_session,
    import_begin,
    import_commit,
    import_put_files,
    import_update_file_types,
)

__all__ = [
    'SessionExistsError',
    'configure',
    'save_session',
    'load_session',
    'list_summaries',
    'delete_session',
    'rename_session',
    'set_session_pinned',
    'load_file',
    'list_favorites',
    'put_favorite',
    'delete_favorite',
    'import_begin',
    'import_add_session',
    'import_put_files',
    'import_update_file_types',
    'import_commit',
    'search_messages',
]
