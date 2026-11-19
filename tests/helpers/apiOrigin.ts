/**
 * api/client.js 在模块顶层读取构建期注入的 __API_ORIGIN__（rspack DefinePlugin）。
 * 需要间接引用 client 链路的测试（如历史归档往返）导入本模块补上等值，
 * 且必须排在该文件其他 import 之前：ESM 按源码顺序求值同级导入。
 */
export const API_ORIGIN_SHIM = 'https://api.deepseek.com'

;(globalThis as { __API_ORIGIN__?: string }).__API_ORIGIN__ ??= API_ORIGIN_SHIM
