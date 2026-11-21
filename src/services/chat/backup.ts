import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { replaceHistory, useChatStore } from './store.js'
import { fail } from './history/errors.js'
import { MAX_ENCRYPTED_ARCHIVE_BYTES } from './history/zipReader.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'
export { MAX_ENCRYPTED_ARCHIVE_BYTES } from './history/zipReader.js'
export { ArchiveDecryptError } from './history/crypto.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导出为历史会话导出格式的 ZIP，可再次导入；提供口令时输出加密容器（.zip.enc）。 */
export const exportHistory = (
  options: { password?: string } = {}
): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const zip = await exportArchive(readSessions())
    if (options.password) {
      const { encryptArchive } = await import('./history/crypto.js')
      return {
        name: `${backupFileName(now)}.enc`,
        blob: await encryptArchive(zip, options.password),
      }
    }
    return { name: backupFileName(now), blob: zip }
  })

/** 文件是否为加密归档容器 */
export const archiveIsEncrypted = (file: File): Promise<boolean> =>
  import('./history/crypto.js').then(({ isEncryptedArchive }) => isEncryptedArchive(file))

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本（加密容器先解密），校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 * 加密容器口令错误或密文损坏时抛 ArchiveDecryptError。
 */
export const importHistory = (file: File, password?: string): Promise<number> =>
  enqueueBackup(async () => {
    // 加密容器在解密前没有任何大小校验，必须在这里提前挡住超大文件
    if (file.size > MAX_ENCRYPTED_ARCHIVE_BYTES) {
      fail('historyImportTooLarge')
    }
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    const { isEncryptedArchive, decryptArchive } = await import('./history/crypto.js')
    let source = file
    if (await isEncryptedArchive(file)) {
      const zip = await decryptArchive(file, password ?? '')
      source = new File([zip], file.name.replace(/\.enc$/i, ''), { type: 'application/zip' })
    }
    await checkArchiveFormat(source)
    return replaceHistory(() => importArchive(source))
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })
