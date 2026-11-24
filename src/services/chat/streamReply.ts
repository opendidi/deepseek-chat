import { translate } from '../../i18n/index.js'
import { showToast } from '../../components/base/toastState.js'
import { ApiError, streamMessage } from '../api/client.js'
import { effortConfigFor } from '../api/types.js'
import type { MessageUsage } from '../api/types.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { useSettings } from '../settings.js'
import {
  findRepeatedSteps,
  isTurnLimitReached,
  resolveChatTools,
  stepSignature,
} from '../agent/toolPolicy.js'
import { runToolSteps } from './agentLoop.js'
import { fetchMcpTools } from '../mcp.js'
import { compressMessages } from './compress.js'
import * as db from './db.js'
import { createLatestReminder } from './latestReminder.js'
import {
  applyEvent,
  getContextRounds,
  settleReply,
  sumUsage,
  toRequestMessages,
  toToolTurnMessages,
  trimToolResults,
} from './reply.js'
import { systemPromptFor } from './requestShape.js'
import {
  get,
  getSession,
  persist,
  runtime,
  set,
  updateReply,
  updateSession,
} from './storeRuntime.js'
import { checkDailyQuota, recordUsage } from './usageLedger.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  ToolStep,
  UserMessage,
} from './types.js'

/** 未记录模型的旧消息、续写时兜底使用的默认模型 */
const DEFAULT_MODEL = 'deepseek-flash' as const
/** 采样温度允许的范围 */
const TEMPERATURE_RANGE = { min: 0, max: 2 } as const
/** 安全审核固定开启，所有请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

export type Request = {
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
}

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = runtime.historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === runtime.historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  // toReversed 需要 Chrome 110+/Safari 16.4+，超出构建目标（chrome >= 105），用拷贝后 reverse 兜底
  for (const [user] of [...getContextRounds(request.history)].reverse()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      // 历史轮次附件补传失败静默跳过：不阻断本轮对话，下次发送时会再次补传
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
export const streamReply = async (
  sessionId: string,
  initial: AssistantMessage,
  request: Request
) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    runtime.titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  /** 本次回答所有工具往返轮次的用量，finally 里累加进 reply.usage 与记账 */
  const roundUsages: MessageUsage[] = []
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  runtime.streamFlushes.set(sessionId, flush)

  try {
    for (let attempt = 0; ; attempt += 1) {
      // 附件失效重试时丢弃之前轮次的用量，只记最终成功这一次
      roundUsages.length = 0
      // 每次请求开始时读取生成参数；中途修改对已开始的回复不生效
      const settings = useSettings.getState()
      const keepRefusedContent = settings.preventWithdraw
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        const prepared = await prepareFiles(sessionId, request, controller.signal)
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : await createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const rawMessages = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder
        )
        const { temperature, topP, maxTokens, systemPrompt } = settings
        const persona = systemPrompt.trim()
        const { messages, summary } = compressMessages(
          rawMessages,
          settings.autoCompress,
          settings.locale
        )
        const system = [systemPromptFor(settings.locale), persona, summary].filter(Boolean).join('\n\n')
        let requestMessages = messages
        // MCP 工具由服务端数据库配置控制（默认关闭）；拉取失败时按无 MCP 工具处理，
        // 不影响本轮对话。仅在非 chat 模式拉取，避免纯聊天请求多一次 HTTP 往返。
        const mcpResult =
          settings.chatMode === 'chat'
            ? { tools: [], error: null }
            : await fetchMcpTools(controller.signal)
        const mcpTools = mcpResult.tools
        const policy = resolveChatTools({
          mode: settings.chatMode,
          search: settings.search,
          agentTools: settings.agentTools,
          enabledTools: new Set(settings.enabledToolNames),
          mcpTools,
          mcpDisabledTools: settings.mcpDisabledTools,
          locale: settings.locale,
        })
        const tools = policy.tools
        /** 已执行过的调用签名，用于阻止模型反复调用同一个工具 */
        const seenSteps = new Set<string>()
        /** 引用比较判断是否收到了新一轮的 usage，避免无用量轮次被重复记账 */
        let previousUsage: MessageUsage | undefined = reply.usage
        /** 执行本轮工具，状态、耗时与结果写回回复供界面展示 */
        const executeToolSteps = async (pending: ToolStep[], signal: AbortSignal) => {
          reply = {
            ...reply,
            toolSteps: (reply.toolSteps ?? []).map((step) =>
              step.status === 'pending'
                ? { ...step, status: 'running' as const, startedAt: Date.now() }
                : step
            ),
          }
          flush()
          const resolved = await runToolSteps(pending, signal, policy.clientNames)
          const resolvedById = new Map(resolved.map((step) => [step.id, step]))
          reply = {
            ...reply,
            toolSteps: (reply.toolSteps ?? []).map((step) => resolvedById.get(step.id) ?? step),
          }
          flush()
        }
        // 推理强度与思考开关来自本轮回复快照，工具往返的每一轮都相同
        const effort = effortConfigFor(initial.thinking, initial.reasoningEffort)
        for (let turn = 0; ; turn += 1) {
          const blockStart = reply.blocks.length
          const stepStart = (reply.toolSteps ?? []).length
          const events = streamMessage(
            {
              model: initial.model ?? DEFAULT_MODEL,
              // 自定义人设与长对话摘要拼接在统一的助手身份说明之后
              system,
              messages: requestMessages,
              thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
              ...(effort ? { output_config: effort } : {}),
              ...(settings.skipSafetyCheck ? {} : { safety_check: SAFETY_CHECK }),
              tools,
              ...(runtime.titleRequests.has(controller) ? { title: { enabled: true } } : {}),
              ...(temperature !== null &&
              temperature >= TEMPERATURE_RANGE.min &&
              temperature <= TEMPERATURE_RANGE.max
                ? { temperature }
                : {}),
              ...(topP !== null && topP >= 0.01 && topP <= 1 ? { top_p: topP } : {}),
              ...(maxTokens !== null && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
            },
            controller.signal
          )
          const blockIndexes = new Map<number, number>()
          for await (const event of events) {
            receivedContent ||= event.type === 'content_block_start'
            if (
              event.type === 'message_delta' &&
              (event.delta.stop_reason === 'end_turn' ||
                event.delta.stop_reason === 'max_tokens') &&
              event.delta.title?.trim() &&
              runtime.titleRequests.has(controller) &&
              !controller.signal.aborted &&
              !get().importingHistory
            ) {
              const title = event.delta.title.trim()
              updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
              runtime.titleRequests.delete(controller)
            }
            reply = applyEvent(reply, event, Date.now(), blockIndexes)
            // 关闭流式输出时中途不逐字刷新，结束时由 finally 一次性写入
            if (settings.streamOutput) {
              if (document.visibilityState === 'hidden') {
                flush()
              } else {
                frame ||= requestAnimationFrame(flush)
              }
            }
          }
          if (reply.usage && reply.usage !== previousUsage) {
            roundUsages.push(reply.usage)
            previousUsage = reply.usage
          }
          if (turn > 0) {
            const blocks = [...reply.blocks]
            const firstText = blocks.findIndex(
              (block, index) => index >= blockStart && block.type === 'text'
            )
            const target = blocks[firstText]
            if (target?.type === 'text') {
              blocks[firstText] = { ...target, agentTurnStart: true }
              reply = { ...reply, blocks }
            }
          }
          if (
            policy.clientNames.size === 0 ||
            reply.stopReason !== 'tool_use' ||
            isTurnLimitReached(turn)
          ) {
            // 到轮次上限时明确提示，避免界面停在半截且毫无反馈
            if (reply.stopReason === 'tool_use' && isTurnLimitReached(turn)) {
              showToast({ key: 'agentTurnLimitReached' })
            }
            break
          }
          const pending = (reply.toolSteps ?? []).filter((step) => step.status === 'pending')
          if (pending.length === 0 || controller.signal.aborted) {
            break
          }
          const repeated = new Set(findRepeatedSteps(pending, seenSteps))
          for (const step of pending) {
            seenSteps.add(stepSignature(step))
          }
          if (repeated.size > 0) {
            // 完全相同的调用再次出现：标成错误回传给模型，然后停止循环
            const now = Date.now()
            reply = {
              ...reply,
              toolSteps: (reply.toolSteps ?? []).map((step) =>
                repeated.has(step.id)
                  ? {
                      ...step,
                      status: 'error' as const,
                      result: translate('agentRepeatedTool'),
                      isError: true,
                      startedAt: now,
                      endedAt: now,
                    }
                  : step
              ),
            }
            const appended = toToolTurnMessages(reply, blockStart, stepStart)
            if (appended) {
              requestMessages = trimToolResults([...requestMessages, ...appended])
            }
            showToast({ key: 'agentRepeatedTool' })
            break
          }
          await executeToolSteps(pending, controller.signal)
          const appended = toToolTurnMessages(reply, blockStart, stepStart)
          if (!appended) {
            break
          }
          // 较早的工具结果替换为摘要，避免多轮往返把上下文挤满
          requestMessages = trimToolResults([...requestMessages, ...appended])
          reply = { ...reply, stopReason: undefined, status: 'streaming' }
        }
        reply = settleReply(reply, 'done', Date.now(), { keepRefusedContent })
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now(), { keepRefusedContent })
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            error: {
              kind: 'upload',
              message: '',
              localMessage: describeUploadError(error),
              retryable: isRetryableApiError(error),
            },
            keepRefusedContent,
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now(), { keepRefusedContent })
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now(), { keepRefusedContent })
        } else if (error instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            error: {
              kind: error.kind,
              message: error.message,
              status: error.status,
              code: error.code,
              localMessage: error.localMessage,
            },
            keepRefusedContent,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            error: {
              kind: 'protocol',
              message: error instanceof Error ? error.message : String(error),
            },
            keepRefusedContent,
          })
        }
        break
      }
    }
  } finally {
    // 多轮工具往返的用量累加成一份，统计与账本才能反映真实请求数
    if (roundUsages.length > 0) {
      reply = {
        ...reply,
        usageRounds: roundUsages,
        usage: sumUsage(roundUsages),
        requestCount: roundUsages.length,
      }
    }
    runtime.titleRequests.delete(controller)
    runtime.streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    // 一轮请求只记一次账：服务端上报了 usage 就写入，含中途失败与用户停止。
    // 账本只存聚合数字，不含对话正文；统计页的明细仍以会话消息为准，避免双算。
    if (reply.usage) {
      recordUsage({
        at: Date.now(),
        model: reply.model,
        sessionId,
        title: getSession(sessionId)?.title ?? '',
        usage: reply.usage,
        pageFetch: reply.blocks.filter(
          (block) =>
            block.type === 'web_fetch_tool_result' &&
            block.content.type === 'web_fetch_result'
        ).length,
        freeServerTools: useSettings.getState().usageFreeServerTools,
      })
      const quota = checkDailyQuota(useSettings.getState().usageDailyQuota)
      if (quota) {
        showToast({
          key: 'usageQuotaReached',
          params: { cost: quota.cost.toFixed(2) },
        })
      }
    }
  }
}
