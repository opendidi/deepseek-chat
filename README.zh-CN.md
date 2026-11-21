# deepseek-chat

[English](README.md) | 简体中文

基于 DeepSeek API 的本地聊天应用：React 前端 + Python（FastAPI + SQLite）存储后端。对话、附件与收藏保存在本机 `data/chats.db` 单文件里，API Key 只保存在本机。

- 本仓库 push 到 `main` 时，`.github/workflows/ci.yml` 会自动运行类型检查、lint、前后端测试与浏览器冒烟测试。

## 快速开始

需要 Node.js 22.12+（CI 使用 24）、pnpm 12.6.0 和 Python 3.11+：

```sh
git clone https://github.com/opendidi/deepseek-chat.git
cd deepseek-chat
pnpm install
pnpm dev:all
```

**日常使用（前端与后端是两个独立服务）**：`pnpm dev:all` 一条命令同时拉起后端 API（:8000）与前端开发服务（:8090，/api 已代理），Ctrl+C 同时退出；也可以分两个终端各自启动：

```sh
python starter.py             # 终端 1：存储后端，纯 API（:8000，不托管前端页面）
pnpm dev                      # 终端 2：前端开发服务器（http://localhost:8090，/api 自动代理到后端）
```

`python starter.py` 首次运行会自动创建虚拟环境；之后仅启动存储 API——前端由 `pnpm dev` 热更新托管。数据保存在 `data/chats.db`（SQLite 单文件，含附件原件），备份即复制该文件；`DATA_DIR` 环境变量可改存储位置。换端口：`--port 8010` / `BACKEND_PORT=8010`（`pnpm dev` 的代理会跟随 `BACKEND_PORT`）。

**生产形态（单端口）**：`pnpm build` 后以默认环境启动 uvicorn——后端同时托管 `dist/` 产物与 API（见 [DEPLOY.md](DEPLOY.md)）。

首次打开时，若浏览器里还留有旧版（IndexedDB 存储）的会话数据，会自动把它们迁移进 SQLite。

部署到服务器（systemd / nginx + HTTPS / Docker）见 [DEPLOY.md](DEPLOY.md)；注意存储接口目前无鉴权，公网部署需搭配 nginx Basic Auth 等访问控制。

## 功能

### 对话

- 多会话、自动标题、重命名、置顶、删除；侧边栏搜索标题与正文（Ctrl/Cmd+K），对话内目录跳转。
- 编辑提问（或空输入框按 ↑ 直接编辑上一条提问）、重新生成、切换消息分支、停止生成（Esc 或停止按钮）、符合条件的继续生成；跨会话收藏回答。
- 当前会话 id 记录在地址栏 `#s=<id>`：刷新页面、复制链接或分享后仍停留在该会话。
- 选中回复中的文字后右键可「引用 / 复制」：引用片段出现在输入框上方（可逐条删除、最多 6 条），提交时与提问一起发给模型，发送后引用区与提问气泡分开显示；触屏长按选字同样可用。
- 长会话默认只渲染最近 60 条消息，顶部按钮可继续加载更早内容。

### 模型与生成参数

- 输入区模型面板：内置 DeepSeek Flash / V4 Pro（含每 1M tokens 价格），也可从云端 `GET /models` 获取模型列表。
- 设置 → 模型：当前模型只读展示，可调温度、Top P、最大输出长度。
- 行为开关：流式输出、防撤回、跳过安全审核、自动压缩长对话、拒绝后继续生成；设置弹窗分为通用设置 / 模型 / 数据管理三区。

### Agent 工具（默认关闭）

- 设置 → 模型 → 启用 Agent 工具后，模型可调用浏览器端工具，并自动完成「调用 → 本地执行 → 回传结果」的多轮循环（最多 6 轮，可随时停止）。
- 内置 `get_current_time`、`calculate`（不使用 `eval`）、`get_page_context`；工具调用步骤与结果在回答中展示。
- **高德地图工具**：在后端 `.env` 中配置 `AMAP_KEY`（高德开放平台「Web 服务」类型）后，Agent 可调用地点搜索（`amap_place_search`）、地理编码（`amap_geocode`）、实时天气（`amap_weather`）与路线规划（`amap_route_planning`）。Key 保存在服务器上，浏览器不接触；工具默认关闭，需按工具粒度开启。
- 关闭时请求不声明客户端工具，保持普通单次对话。

### 输入、阅读与界面

- 附件上传 / 粘贴 / 拖拽、语音输入、回复朗读；移动端录音时显示实时频谱。
- 自定义提示词（人设）、提示词库与斜杠命令（输入 `/`）、输入历史（空输入框按 ↑/↓）。
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表、来源引用、图片点击放大。
- 中英文、浅色 / 深色主题、字号、移动端布局、位置设置、PWA 安装（应用内安装入口与更新提示）、断网提示、用量统计。
- 全局快捷键：Ctrl/Cmd+K 搜索、Ctrl/Cmd+Shift+O 新对话、Ctrl/Cmd+, 打开设置；生成中按 Esc 停止回答。

### 数据迁移

- 单会话导出 Markdown；历史导入导出（ZIP）、密码加密导出（PBKDF2 + AES-256-GCM）、删除所有对话。
- 设置 → 统计：按今天 / 7 天 / 30 天汇总费用估算、Token、模型分布、会话排行与每日趋势；含附加用量、计费口径、上下文占用估算及 JSON / CSV 导出。费用按官方单价与高峰时段估算，服务端上报的准确用量以 KPI 为准。

## 数据与存储

API Key 与设置保存在浏览器 localStorage；会话、附件原件与收藏保存在本机 `data/chats.db`（SQLite 单文件，由 Python 后端读写），附件原件存在同一文件的 BLOB 列里。设置 → 数据管理可关闭「在本机记住 API Key」，关闭后 Key 只存在内存中，刷新需重新输入。会话 id 会出现在地址栏 hash 中，但不包含任何对话内容。发送消息、上传附件、使用语音功能时，相应内容会提交给配置的 API 服务。

存储后端只监听 `127.0.0.1`，仅本机可访问；保存、删除与导入都在 SQLite 事务内完成，导入失败不会破坏现有数据。备份只需复制 `data/chats.db`（建议先停止后端再复制）。

导入会在确认并校验成功后替换全部本地会话与附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。加密导出用口令派生密钥（PBKDF2 + AES-256-GCM）把 ZIP 包成加密容器，导入时输入导出口令即可解密。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                                          |
| ------------- | --------------------------------------------- |
| `pnpm dev`    | 启动前端开发服务器（默认 8090，`/api` 代理到后端；可用 `PORT` 覆盖） |
| `pnpm dev:all` | 后端 + 前端开发服务一起启动（Ctrl+C 同时退出） |
| `pnpm backend` | 启动存储后端（`http://127.0.0.1:8000`，托管 dist 与 /api） |
| `python starter.py` | 仅启动存储后端（venv 自举，纯 API :8000） |
| `pnpm build`  | 构建到 `dist/`                                |
| `pnpm type`   | TypeScript 类型检查                           |
| `pnpm lint`   | oxlint 检查                                   |
| `pnpm test`   | 编译并运行 node:test 单元测试                 |
| `pnpm test:backend` | 运行后端 pytest 测试 |
| `pnpm format` | oxfmt 格式化                                  |
| `pnpm icons`  | 重新生成 PWA 图标到 `public/`                 |
| `pnpm scss:types` | 为 CSS Modules 补齐 `*.module.scss.d.ts` |
| `pnpm scss:types:check` | 校验样式类型声明是否同步（CI 使用） |
| `pnpm test:e2e` | 生产构建 + 真实后端上的浏览器冒烟测试（需本机 Chrome） |

样式全部使用 SCSS：组件样式为 `*.module.scss`（CSS Modules），全局样式为 `*.scss`。所有组件样式都有配套 `*.module.scss.d.ts`（手写或由 `pnpm scss:types` 生成），因此类名拼写错误会在类型检查阶段暴露。rspack 先用 `sass-loader` 编译，再交给 `builtin:lightningcss-loader` 按目标浏览器降级；第三方 CSS（如 KaTeX）仍走原有的 `.css` 规则。

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理；也可以在「设置 → 通用设置 → API 地址」里运行时覆盖。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求包含搜索、链接阅读、标题、`latest_reminder` 等扩展，开启 Agent 时还会声明客户端工具；接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

Prism 语言包与 Mermaid 依赖在构建时合并成少量异步块，避免产生几十个碎片请求。push 到 `main` 时 [CI](.github/workflows/ci.yml) 依次执行类型检查、样式声明校验、lint、前端单元测试、后端 pytest、构建和浏览器冒烟测试。

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
