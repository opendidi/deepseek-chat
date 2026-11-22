# 部署指南

把 deepseek-chat 部署到一台服务器（VPS / 家庭服务器 / Docker），供浏览器远程访问。

**先读这一段（架构决定了部署方式）**：后端只负责存储，DeepSeek API 请求始终由各访问者的浏览器直发
（各自填自己的 API Key，服务器上没有也不需要 Key）。因此：

- 所有访问者**共享同一个** `data/chats.db`（会话历史是共用的一份），删除操作影响所有人；
- ⚠️ **存储接口没有任何鉴权**：直接暴露公网 = 任何人都能读写、删除全部会话。公网部署务必搭配
  「应用内口令」（待实现）或 nginx Basic Auth（见方式三），或仅在内网使用。

部署产物：`dist/`（前端）+ `server/`（存储后端）+ 一个 SQLite 文件。

---

## 方式一：服务器直接跑（最简单）

适用：内网 / 家庭服务器 / 个人试水。

```sh
git clone <你的仓库> && cd deepseek-chat

# 1) 构建前端（服务器需 Node 22+ 与 pnpm；也可以本地构建后只上传 dist/）
pnpm install
pnpm build

# 2) 安装后端依赖（Python 3.11+）
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

# 3) 启动（默认托管 dist/ 前端产物与 /api；SERVE_DIST=0 可关掉托管只留 API）
.venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port 8000
```

本地构建、服务器不装 Node 的做法：本地 `pnpm build` 后把 `dist/`、`server/`、`requirements.txt`、
`starter.py`（或直接用 uvicorn）上传到服务器同一目录，跳过第 1 步。

浏览器访问 `http://服务器IP:8000`；防火墙/安全组放行 8000。

## 方式二：systemd 常驻（推荐与方式一、三搭配）

```ini
# /etc/systemd/system/deepseek-chat.service
[Unit]
Description=deepseek-chat storage backend
After=network.target

[Service]
WorkingDirectory=/opt/deepseek-chat
ExecStart=/opt/deepseek-chat/.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3
Environment=DATA_DIR=/opt/deepseek-chat/data
# 可选：访问口令（或改用 EnvironmentFile=/opt/deepseek-chat/.env）
# Environment=ACCESS_PASSWORD=change-me
# 可选：高德 Web 服务 Key（Agent 地图工具）
# Environment=AMAP_KEY=your-amap-web-service-key
# 公网部署强烈建议设置访问口令（前端会弹出输入门）；不设置则 /api 对能访问到服务的人完全开放

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now deepseek-chat
```

配合 nginx 反代（方式三）时后端只监听 127.0.0.1，不直接对外。

## 方式三：nginx + HTTPS（公网部署推荐）

PWA 安装、Service Worker、自动迁移提示只在 HTTPS（安全上下文）下生效；公网请务必上域名 + 证书。

```nginx
server {
    server_name chat.example.com;

    # 可选：Basic Auth 挡门（公网无鉴权直裸奔强烈建议开启）
    # 生成口令文件：htpasswd -c /etc/nginx/.htpasswd yourname
    # auth_basic "deepseek-chat";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```sh
sudo certbot --nginx -d chat.example.com   # 自动补 443 与证书续期
```

## 方式四：Docker

```dockerfile
# Dockerfile（多阶段：Node 构建 → Python 运行）
FROM node:22-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm i -g pnpm@12 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN python -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

```yaml
# docker-compose.yml
services:
  deepseek-chat:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data     # SQLite 数据持久化在宿主机 ./data
    restart: unless-stopped
```

公网部署同样建议在容器前挂一层 nginx（HTTPS + Basic Auth）。

---

## 方式五：开发板（树莓派等 ARM Linux 单板机）

适用：树莓派 4/5、Orange Pi 等跑 **Debian 系 arm64 系统**（如 Raspberry Pi OS Bookworm）的板子。
后端依赖全部为纯 Python（pydantic-core 有 aarch64 预编译 wheel），板子上**无需安装编译器**；
前端在电脑上构建好再上传，板子不需要 Node。

### 1. 电脑上构建前端

```sh
pnpm install && pnpm build    # 产出 dist/
```

### 2. 上传到板子（或板子 git clone 后只补传 dist/）

```sh
# <板子IP> 换成实际地址；同网段也可以用主机名（树莓派默认 raspberrypi.local）
scp -r dist server requirements.txt starter.py 用户名@板子IP:~/deepseek-chat/
```

### 3. 板子上装后端并启动

```sh
cd ~/deepseek-chat
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port 8000
```

浏览器访问 `http://板子IP:8000`（或 `http://raspberrypi.local:8000`）；防火墙放行 8000。

### 4. 常驻（systemd，开机自启）

用方式二的 unit 文件，注意两点：`WorkingDirectory` 改成板子上的项目路径；
板上 Python 若低于 3.11（旧版 Bullseye 系统是 3.9），先装 3.11+（`apt` 源没有就用
`uv venv --python 3.11` 或 pyenv），`ExecStart` 指向对应解释器。

### 板子特有的注意事项

- **Python ≥ 3.11**：Bookworm 系统自带 3.11 可直接用；Bullseye 及更旧的系统需要先升级 Python。
- **存储介质**：默认 `data/` 在 SD 卡上，SQLite WAL 长期写入有磨损，也建议插 SSD/NVMe 时用
  `DATA_DIR=/mnt/ssd/deepseek-chat/data` 指过去。
- **内存**：512MB 即可运行（uvicorn 单进程 + SQLite）；GZip 已内置，局域网传输量小。
- **DeepSeek API Key**：请求由各访问者的浏览器直发，板上不需要配置任何 Key。
- **公网/多人访问**：与方式一相同，务必配 `ACCESS_PASSWORD`（`.env` 或 systemd Environment）。

---

## 数据与运维

- **备份**：停服后复制 `data/chats.db`（附件原件也在其中）；`DATA_DIR` 环境变量可改位置。
- **环境变量**：复制 `.env.example` 为 `.env` 即可配置数据目录与访问口令（`ACCESS_PASSWORD`），`starter.py` 与 uvicorn 都会自动读取；模板见 [.env.example](.env.example)。
- **升级**：`git pull` → 重新 `pnpm build`（或上传新 dist）→ 重启服务；SQLite 数据不受影响。
- **日志**：uvicorn 输出在 systemd journal（`journalctl -u deepseek-chat`）或容器日志里。
- **多用户语义**：当前是单库共享模型。要每人独立历史，需要新增用户体系（较大改动，尚未实现）。
