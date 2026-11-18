# deepseek-chat

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天前端。无需应用后端：浏览器直接请求配置的 API 服务，API Key 只保存在本机。

- 上游在线示例：<https://deepseek-ai.github.io/chat-demo/>
- 本仓库 push 到 `main` 时，`.github/workflows/pages.yml` 会自动构建并发布 GitHub Pages（需在仓库设置中启用 Pages）。
- 也可从 [Releases](https://github.com/opendidi/deepseek-chat/releases) 下载构建包，解压后双击 `index.html` 本地使用，无需安装或构建。首次使用请在设置中填写 API Key。

## 快速开始

需要 Node.js 22.12+（CI 使用 24）和 pnpm：

```sh
git clone https://github.com/opendidi/deepseek-chat.git
cd deepseek-chat
pnpm install
pnpm dev
```

`pnpm dev` 默认监听 `http://localhost:8090` 并自动打开浏览器。端口被占用时可用 `PORT=8091 pnpm dev`，或 `PORT=auto pnpm dev` 让开发服务器自动挑选空闲端口。

构建静态产物：

```sh
pnpm build
```

产物写入 `dist/`。资源使用相对路径，把静态服务器根目录指向 `dist/` 即可，也能托管在任意子路径下（如 GitHub Pages 的 `/deepseek-chat/`）。直接打开 `dist/index.html` 需要浏览器允许 `file://` 页面存储，且 API 服务允许来自 `file://` 的跨域请求。页面通过 meta CSP 限制脚本来源；部署时建议为 JS/CSS 开启 gzip 或 brotli 压缩。

## 功能

### 对话

- 多会话、自动标题、重命名、置顶、删除；侧边栏搜索标题与正文（Ctrl/Cmd+K），对话内目录跳转。
- 编辑提问、重新生成、切换消息分支、停止生成、符合条件的继续生成；跨会话收藏回答。
- 当前会话 id 记录在地址栏 `#s=<id>`：刷新页面、复制链接或分享后仍停留在该会话。

### 模型与生成参数

- 输入区模型面板：内置 DeepSeek Flash / V4 Pro（含每 1M tokens 价格），也可从云端 `GET /models` 获取模型列表。
- 设置 → 模型：当前模型只读展示，可调温度、Top P、最大输出长度。
- 行为开关：流式输出、防撤回、跳过安全审核、自动压缩长对话、拒绝后继续生成；设置弹窗分为通用设置 / 模型 / 数据管理三区。

### Agent 工具（默认关闭）

- 设置 → 模型 → 启用 Agent 工具后，模型可调用浏览器端工具，并自动完成「调用 → 本地执行 → 回传结果」的多轮循环（最多 6 轮，可随时停止）。
- 内置 `get_current_time`、`calculate`（不使用 `eval`）、`get_page_context`；工具调用步骤与结果在回答中展示。
- 关闭时请求不声明客户端工具，保持普通单次对话。

### 输入、阅读与界面

- 附件上传 / 粘贴 / 拖拽、语音输入、回复朗读；移动端录音时显示实时频谱。
- 自定义提示词（人设）、提示词库与斜杠命令（输入 `/`）、输入历史（空输入框按 ↑/↓）。
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表、来源引用、图片点击放大。
- 中英文、浅色 / 深色主题、字号、移动端布局、位置设置、PWA 安装、用量统计。
- 全局快捷键：Ctrl/Cmd+K 搜索、Ctrl/Cmd+Shift+O 新对话、Ctrl/Cmd+, 打开设置。

### 数据迁移

- 单会话导出 Markdown；历史导入导出（ZIP）、密码加密导出（PBKDF2 + AES-256-GCM）、删除所有对话。

## 数据与存储

API Key 与设置保存在浏览器 localStorage；会话及附件原件保存在 IndexedDB，按浏览器用户配置与站点源（origin）隔离。设置 → 数据管理可关闭「在本机记住 API Key」，关闭后 Key 只存在内存中，刷新需重新输入。会话 id 会出现在地址栏 hash 中，但不包含任何对话内容。发送消息、上传附件、使用语音功能时，相应内容会提交给配置的 API 服务。

导入会在确认并校验成功后替换全部本地会话与附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。加密导出用口令派生密钥（PBKDF2 + AES-256-GCM）把 ZIP 包成加密容器，导入时输入导出口令即可解密。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                                          |
| ------------- | --------------------------------------------- |
| `pnpm dev`    | 启动开发服务器（默认 8090，可用 `PORT` 覆盖） |
| `pnpm build`  | 构建到 `dist/`                                |
| `pnpm type`   | TypeScript 类型检查                           |
| `pnpm lint`   | oxlint 检查                                   |
| `pnpm test`   | 编译并运行 node:test 单元测试                 |
| `pnpm format` | oxfmt 格式化                                  |
| `pnpm icons`  | 重新生成 PWA 图标到 `public/`                 |

样式全部使用 SCSS：组件样式为 `*.module.scss`（CSS Modules），全局样式为 `*.scss`。rspack 先用 `sass-loader` 编译，再交给 `builtin:lightningcss-loader` 按目标浏览器降级；第三方 CSS（如 KaTeX）仍走原有的 `.css` 规则。部分组件有手写 `*.module.scss.d.ts` 类型声明，其余由 `src/env.d.ts` 的通配声明兜底。

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理；也可以在「设置 → 通用设置 → API 地址」里运行时覆盖。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求包含搜索、链接阅读、标题、`latest_reminder` 等扩展，开启 Agent 时还会声明客户端工具；接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    agent/             客户端工具定义与执行器
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储、工具循环与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
