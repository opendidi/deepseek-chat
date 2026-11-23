# deepseek-chat

English | [简体中文](README.zh-CN.md)

A local chat app for the DeepSeek API: a React front end plus a Python (FastAPI + SQLite) storage backend. Chats, attachments and favorites live in a single local `data/chats.db` file; the API key stays on the device.

- Pushing to `main` runs type checks, lint, front-end/back-end tests and a browser smoke test through `.github/workflows/ci.yml`.

## Getting started

Install Node.js 22.12+ (CI uses 24), pnpm 12.6.0 and Python 3.11+:

```sh
git clone https://github.com/opendidi/deepseek-chat.git
cd deepseek-chat
pnpm install
python starter.py
```

**Daily use (front end and back end are separate services)**:

```sh
pnpm dev:all                  # one command: backend API (:8000) + front-end dev server (:8090, /api proxied)
```

Or run them in separate terminals —

```sh
python starter.py             # terminal 1: storage backend, pure API on :8000 (no front end served)
pnpm dev                      # terminal 2: front-end dev server (http://localhost:8090, /api proxied to the backend)
```

`python starter.py` bootstraps the venv on first run and starts the storage API only — the front end is served by `pnpm dev` with hot reload. Data lives in `data/chats.db` (a single SQLite file including attachment blobs) — backing up is copying that file; set the `DATA_DIR` environment variable to change the location. Options: `--port 8010` / `BACKEND_PORT=8010` to change the backend port (`pnpm dev` follows `BACKEND_PORT` for the proxy).

**Production shape (single port)**: `pnpm build` then start uvicorn without `SERVE_DIST` — the backend serves the `dist/` build and the API together (see [DEPLOY.md](DEPLOY.md)).

On first launch, any existing chat data stored in the browser (previous IndexedDB version) is migrated into SQLite automatically.

For server deployment (systemd / nginx + HTTPS / Docker) see [DEPLOY.md](DEPLOY.md); note the storage API has no built-in auth — pair a public deployment with nginx Basic Auth or similar access control.

## Features

### Conversations

- Multiple conversations with automatic titles, renaming, pinning, and deletion; sidebar search across titles and message contents (Ctrl/Cmd+K), and an in-chat outline for jumping to questions.
- Edit prompts (or press ↑ in an empty input box to edit the previous question), regenerate replies, switch message branches, stop generation (Esc or the stop button), and continue eligible replies; bookmark answers across chats.
- The active conversation id lives in the URL hash (`#s=<id>`), so reloading, copying the link, or sharing it keeps you in the same chat.
- Right-click selected text in a reply to **Quote / Copy**. Quotes appear above the input (removable, up to 6), are sent to the model together with the next message, and are displayed separately from the question bubble. Long-press selection works on touch devices too.
- Long chats render the latest 60 messages by default; a top button loads earlier ones.

### Models and generation settings

- Model panel in the input area: built-in DeepSeek Flash / V4 Pro with per-1M-token pricing, plus an optional model list fetched from `GET /models`.
- Settings → Model shows the current model (read-only) and lets you adjust temperature, Top P, and max output tokens.
- Behavior toggles: stream output, keep refused content, skip safety check, auto-compress long chats, and continue after refusal. The settings dialog is split into General / Model / Data.

### Agent tools (off by default)

- After enabling Settings → Model → Agent tools, the model can call browser-side tools and automatically run multiple "call → execute locally → return result" turns (up to 6, stoppable at any time).
- Built-in tools: `get_current_time`, `calculate` (no `eval`), and `get_page_context`. Tool steps and results are shown in the reply.
- **Amap map tools**: set `AMAP_KEY` (an Amap "Web service" key) in the backend `.env` and the agent can search places (`amap_place_search`), geocode addresses (`amap_geocode`), fetch live weather (`amap_weather`), and plan routes (`amap_route_planning`). The key stays on the server; tools are off by default — enable them per tool.
- When disabled, no client tools are declared and the chat stays a single ordinary request.

### Input, reading, and interface

- Upload, paste, or drag and drop attachments; voice input and read-aloud replies; a live audio spectrum while recording on mobile.
- Custom instructions (persona), a prompt library with slash commands (type `/`), and input history (↑/↓ in an empty input box).
- Markdown, syntax highlighting, KaTeX math, Mermaid diagrams, source citations, and a click-to-zoom image viewer.
- Simplified Chinese and English, light and dark themes, font size, mobile layouts, location settings, PWA install (in-app install entry and update notice), offline notice, and usage statistics.
- Global shortcuts: Ctrl/Cmd+K search, Ctrl/Cmd+Shift+O new chat, Ctrl/Cmd+, settings; Esc stops an in-flight reply.

### Data migration

- Export a single chat as Markdown; import/export history as ZIP, password-encrypted export (PBKDF2 + AES-256-GCM), and delete all conversations.
- Settings → Usage: today / 7-day / 30-day views of estimated cost, tokens, model breakdown, top sessions and daily trends, plus extras, billing rules, estimated context usage and JSON / CSV export. Costs are estimated from official prices and peak hours; exact server-reported usage is shown in the KPIs.

## Data and storage

Settings are stored in the browser's localStorage. The API Key lives only in the server's `.env` (`DEEPSEEK_API_KEY`) and never reaches the browser. Conversations, original attachments, and favorites are stored in the local `data/chats.db` file (a single SQLite database written by the Python backend), with attachment blobs inside the same file. The conversation id appears in the URL hash but contains no message content. Chat, attachment uploads, and speech features go through the server's `/api/deepseek/*` proxy, which injects the Key.

The storage backend listens on `127.0.0.1` in local development, but the production single-port setup (and `scripts/setup-board.sh`) binds `0.0.0.0` to serve LAN devices — set `ACCESS_PASSWORD` in `.env` or put an authenticating reverse proxy in front. Saves, deletions, and imports run inside SQLite transactions; a failed import never damages existing data. To back up, copy `data/chats.db` and `.env` (stop the backend first); set `DATA_DIR` via `.env` to relocate it.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details. Encrypted export wraps the ZIP in a password-protected container (PBKDF2 + AES-256-GCM); enter the export password to import it again.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                                             |
| ------------- | ------------------------------------------------------- |
| `pnpm dev`    | Start the front-end dev server (port 8090 by default, `/api` proxied to the backend; `PORT` overrides) |
| `pnpm dev:all` | Start the backend and the front-end dev server together (Ctrl+C stops both) |
| `pnpm backend` | Start the storage backend (`http://127.0.0.1:8000`, serves dist and /api) |
| `python starter.py` | Start the storage backend only (venv bootstrap, pure API on :8000) |
| `pnpm build`  | Build into `dist/`                                      |
| `pnpm type`   | Run TypeScript type checks                              |
| `pnpm lint`   | Lint with oxlint                                        |
| `pnpm test`   | Compile and run node:test unit tests                    |
| `pnpm test:backend` | Run the backend pytest suite |
| `pnpm format` | Format with oxfmt                                       |
| `pnpm icons`  | Regenerate PWA icons into `public/`                     |
| `pnpm scss:types` | Generate missing `*.module.scss.d.ts` declarations |
| `pnpm scss:types:check` | Verify declarations are in sync (used in CI) |
| `pnpm test:e2e` | Browser smoke test on the production build with the real backend (needs Chrome) |

> Lint note: `react/refs`, `react/set-state-in-effect` and `react/purity` are disabled in
> `.oxlintrc.json` — they are React Compiler constraints, and this project builds with SWC
> without the Compiler. Writing a ref during render so a `useMemo` can read the latest value
> is intentional here; moving it into an effect would read a stale value instead.


All styles are SCSS: component styles use `*.module.scss` (CSS Modules) and global styles use `*.scss`. Every component stylesheet has a matching `*.module.scss.d.ts` (hand-written or generated by `pnpm scss:types`), so typos in class names are caught by the type checker. rspack compiles them with `sass-loader` and then downlevels them with `builtin:lightningcss-loader`; third-party CSS (such as KaTeX) still uses the plain `.css` rule.

All model requests go to the same-origin `/api/deepseek/*` proxy; the upstream endpoint is set server-side via `DEEPSEEK_BASE_URL` in `.env` (default `https://api.deepseek.com`). [rspack.config.ts](rspack.config.ts) only handles the development server proxy (`createConfig({ devServer })`).

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, plus client tool declarations when Agent tools are enabled, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

Prism language packs and Mermaid dependencies are merged into a handful of async chunks at build time to avoid dozens of tiny requests. On every push to `main`, [CI](.github/workflows/ci.yml) runs type checks, SCSS declaration checks, lint, front-end unit tests, backend pytest, the build, and a browser smoke test.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    agent/             Client-side tool definitions and runner
    api/               API requests, SSE, and protocol types
    chat/              Conversations, branches, storage, tool loop, history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
