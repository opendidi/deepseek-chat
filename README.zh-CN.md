# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`。资源使用相对路径，把静态服务器根目录指向 `dist/` 即可，也能托管在任意子路径下（如 GitHub Pages 的 `/chat-demo/`）。也可直接打开 `dist/index.html`，此时浏览器需允许 `file://` 页面的存储，且 API 服务需允许来自 `file://` 的跨域请求。页面通过 meta CSP 限制脚本来源，部署时建议同时为 JS/CSS 开启 gzip 或 brotli 压缩。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。
- 模型切换（输入区或设置里选择 deepseek-flash / deepseek-v4-pro），可调温度与最大输出长度。
- 自定义提示词（人设）、提示词库与输入框斜杠命令（输入 `/` 快速填入）。
- 会话置顶、侧边栏搜索（标题与正文，快捷键 Ctrl/Cmd+K）、跨会话收藏回答。
- 对话内目录跳转、图片点击放大查看、已发送消息的输入历史（空输入框按 ↑/↓）。
- 单个会话导出 Markdown、用量统计面板、加密导出与导入（密码保护）。
- 字体大小设置、全局快捷键（Ctrl/Cmd+K 搜索、Ctrl/Cmd+Shift+O 新对话、Ctrl/Cmd+, 打开设置）与 PWA 安装支持。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。在设置 → 数据管理里可关闭「在本机记住 API Key」，关闭后 Key 只保存在内存中，刷新页面需重新输入。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。加密导出使用口令派生密钥（PBKDF2 + AES-256-GCM）把 ZIP 包成加密容器，导入时输入导出口令即可解密。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                          |
| ------------- | ----------------------------- |
| `pnpm dev`    | 启动开发服务器                |
| `pnpm build`  | 构建到 `dist/`                |
| `pnpm type`   | TypeScript 类型检查           |
| `pnpm lint`   | oxlint 检查                   |
| `pnpm test`   | 运行单元测试                  |
| `pnpm format` | oxfmt 格式化                  |
| `pnpm icons`  | 重新生成 PWA 图标到 `public/` |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理；也可以在「设置 → 通用设置 → API 地址」里运行时覆盖。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
