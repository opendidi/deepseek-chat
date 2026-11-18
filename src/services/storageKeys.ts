/**
 * 项目标识从 chat-demo 改成 deepseek-chat 后，localStorage 键前缀的一次性迁移。
 * 本模块被所有读写 localStorage 的服务 import，ESM 会先执行这里的顶层迁移，
 * 保证 settings / prompts / inputHistory 在初始化时读到的已经是新键。
 */
export const OLD_STORAGE_PREFIX = 'chat-demo:'
export const NEW_STORAGE_PREFIX = 'deepseek-chat:'

type StorageLike = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'
>

/** 纯函数便于单测：新键已存在时不覆盖，全部搬完再删除旧键 */
export const migrateStoragePrefix = (
  storage: StorageLike,
  oldPrefix: string,
  newPrefix: string
): void => {
  const legacy: { key: string; value: string }[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (!key || !key.startsWith(oldPrefix)) {
      continue
    }
    const value = storage.getItem(key)
    if (value !== null) {
      legacy.push({ key, value })
    }
  }
  for (const { key, value } of legacy) {
    const next = newPrefix + key.slice(oldPrefix.length)
    if (storage.getItem(next) === null) {
      storage.setItem(next, value)
    }
  }
  for (const { key } of legacy) {
    storage.removeItem(key)
  }
}

let migrated = false

export const migrateLegacyStorageKeys = (): void => {
  if (migrated) {
    return
  }
  migrated = true
  try {
    if (typeof localStorage !== 'undefined') {
      migrateStoragePrefix(localStorage, OLD_STORAGE_PREFIX, NEW_STORAGE_PREFIX)
    }
  } catch {
    // 隐私模式或 file:// 下存储不可用，保持内存行为即可
  }
}

migrateLegacyStorageKeys()
