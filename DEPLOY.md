# 部署指南

deepseek-chat 的完整部署手册：本地开发、服务器、Docker、ARM 开发板（树莓派 / Jetson），
以及实际踩过的坑（见文末 FAQ）。

## 目录

- [0. 架构与服务形态](#0-先了解架构决定了部署方式)
- [1. 本地开发（前后端分离）](#1-本地开发前后端分离)
- [2. 生产形态一：单端口直跑](#2-生产形态一单端口直跑最简单)
- [3. 生产形态二：systemd 常驻](#3-生产形态二systemd-常驻开机自启)
- [4. 生产形态三：nginx 反向代理](#4-生产形态三nginx-反向代理)
- [5. Docker](#5-docker)
- [6. 开发板（ARM Linux 单板机）](#6-开发板arm-linux-单板机)
- [7. 数据与运维](#7-数据与运维)
- [8. 踩坑 FAQ](#8-踩坑-faq均为实际出现过的错误)
- [9. 部署后验证清单](#9-部署后验证清单)

---

## 0. 先了解：架构决定了部署方式

- **前端**（React 构建产物 `dist/`）与**后端**（FastAPI + SQLite，`server/`）是两个独立服务；
  生产单端口形态下由后端同时托管两者。
- **DeepSeek API 请求始终由访问者的浏览器直发**（各自填自己的 API Key）——服务器上没有、
  也不需要任何 Key。
- 所有访问者**共享同一个** `data/chats.db`（会话历史共用一份），删除操作影响所有人。
- ⚠️ **存储接口默认无鉴权**：公网部署务必设置 `ACCESS_PASSWORD`（应用内口令，已实现，
  前端会弹输入门）或 nginx Basic Auth，否则任何人都能读写、删除全部会话。
- 部署产物：`dist/`（前端）+ `server/`（后端代码）+ `requirements.txt`（锁定版本依赖）+
  一个 SQLite 文件。

### 运行拓扑

```text
浏览器（局域网设备 / 公网）
  │  各自填 DeepSeek API Key，请求由浏览器直发 api.deepseek.com
  ▼
nginx :80（可选：gzip / HTTPS / Basic Auth / SSE 关缓冲）
  ▼
uvicorn :8000（127.0.0.1，systemd 常驻）
  ├── 托管 dist/ 静态产物（带 hash 资源下发一年 immutable 缓存）
  ├── /api/* 存储接口（GZip 压缩）
  ▼
SQLite data/chats.db（WAL 模式，含附件原件）
```

### 服务形态速查

| 场景 | 用法 | 说明 |
|---|---|---|
| 本地开发 | `pnpm dev:all` | 前后端分离：API :8000 + devServer :8090（热更新） |
| 本地开发（分终端） | `python starter.py` + `pnpm dev` | starter 只起纯 API，前端走 devServer |
| 内网/家用服务器 | 单端口直跑 | uvicorn 托管 dist + API |
| 服务器常驻 | systemd | 开机自启 + 崩溃拉起，配 nginx |
| 公网 | nginx + HTTPS | PWA/Service Worker 需要 HTTPS 安全上下文 |
| 容器 | Docker / compose | 多阶段构建，见下 |
| ARM 开发板 | 见「开发板」章节 | 树莓派 / Jetson，板子不需要 Node |

---

## 1. 本地开发（前后端分离）

```sh
pnpm dev:all        # 一条命令双启：后端 API(:8000) + 前端 devServer(:8090，/api 已代理)
```

或分两个终端：

```sh
python starter.py   # 终端 1：纯 API 后端（首次自动建 venv；不托管前端页面）
pnpm dev            # 终端 2：前端 devServer（热更新；PORT=8091 可换端口）
```

- 后端显式 `SERVE_DIST=0`：纯 API；访问 `/` 会返回 404 提示（含各形态指引）。
- `BACKEND_PORT=8010` 可换后端端口，devServer 的代理会跟随。
- 生产构建预览：`pnpm build` 后去掉 `SERVE_DIST=0` 直接跑 uvicorn，即下面的单端口形态。

---

## 2. 生产形态一：单端口直跑（最简单）

适用：内网 / 家庭服务器 / 个人试水。

```sh
git clone <你的仓库> && cd deepseek-chat

# 1) 构建前端（服务器需 Node 22+ 与 pnpm；也可以本地构建后只上传 dist/）
pnpm install
pnpm build

# 2) 安装后端依赖（Python 3.11+）
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

# 3) 启动（默认托管 dist/ 与 /api；SERVE_DIST=0 关掉托管只留 API）
.venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port 8000
```

本地构建、服务器不装 Node 的做法：本地 `pnpm build` 后把 `dist/`、`server/`、
`requirements.txt`、`starter.py` 上传到服务器同一目录，跳过第 1 步。

浏览器访问 `http://服务器IP:8000`；防火墙/安全组放行 8000。

---

## 3. 生产形态二：systemd 常驻（开机自启）

```ini
# /etc/systemd/system/deepseek-chat.service
[Unit]
Description=deepseek-chat storage backend
After=network.target local-fs.target
# 项目在 U 盘/移动盘上时必须等挂载就绪，否则开机自启会因目录不存在而失败
# RequiresMountsFor=/mnt/usb/deepseek

[Service]
WorkingDirectory=/opt/deepseek-chat
ExecStart=/opt/deepseek-chat/.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3
User=xiaodi
Environment=DATA_DIR=/opt/deepseek-chat/data
# 可选：访问口令（或改用 EnvironmentFile=/opt/deepseek-chat/.env）
# Environment=ACCESS_PASSWORD=change-me
# 可选：高德 Web 服务 Key（Agent 地图工具）
# Environment=AMAP_KEY=your-amap-web-service-key

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable deepseek-chat     # 开机自启动
sudo systemctl start deepseek-chat      # 启动；与终端窗口解耦，关窗口照常运行
```

常用管理命令：

```sh
systemctl status deepseek-chat      # 状态
systemctl restart deepseek-chat     # 重启（改代码/配置后）
systemctl stop deepseek-chat        # 停止
systemctl is-enabled deepseek-chat  # 确认自启动（应输出 enabled）
journalctl -u deepseek-chat -f      # 实时日志
journalctl -u deepseek-chat -n 50   # 最近 50 行
```

⚠️ 启动失败先查端口占用：之前在终端里手动跑的 uvicorn 会占住 8000（报
`address already in use`），先 Ctrl+C 或 `sudo pkill -f "uvicorn server.app"` 再 start。
不要用 nohup / tmux / cron 兜底：它们没有崩溃拉起、开机自启与日志收集，关机就丢。

要点：`--host 127.0.0.1` 只监听本机，对外统一走 nginx（见下节）；路径按实际项目位置改。

---

## 4. 生产形态三：nginx 反向代理

### 4.1 全转发（推荐，后端托管 dist）

```nginx
# /etc/nginx/sites-available/deepseek-chat
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 100m;    # 导入 / 附件上传的上限

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css;

    location / {
        proxy_pass http://127.0.0.1:8000;    # ⚠️ 结尾【不要】带斜杠，否则 /api 前缀被剥掉
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_buffering off;                 # 聊天回复是 SSE 流式，缓冲会卡住打字机效果
        proxy_read_timeout 300s;
    }
}
```

后端此时是单端口全托管形态（`SERVE_DIST` 默认开），带 hash 的静态资源由后端下发
一年 `immutable` 缓存头，nginx 透传即可。

```sh
sudo ln -sf /etc/nginx/sites-available/deepseek-chat /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### 4.2 nginx 出静态 + API 反代（可选）

让 nginx 直接出 dist 静态文件（root 放 server 层，正则 location 才能继承）：

```nginx
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 100m;

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css;

    root /mnt/usb/deepseek/dist;
    index index.html;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|woff2?|svg|webp|map)$ {
        expires 30d;
        add_header Cache-Control "public";
        access_log off;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;    # 结尾同样不带斜杠
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

此形态建议给后端加 `Environment=SERVE_DIST=0`（纯 API），并放行 dist 目录权限：

```sh
sudo chmod -R a+rX /mnt/usb/deepseek/dist    # nginx worker(www-data) 需要可读
```

### 4.3 HTTPS + Basic Auth（公网必配）

PWA 安装、Service Worker、自动迁移提示只在 HTTPS（安全上下文）下生效。

```nginx
server {
    server_name chat.example.com;

    # Basic Auth 挡门（公网无鉴权直裸奔强烈建议开启）
    # 生成口令文件：htpasswd -c /etc/nginx/.htpasswd yourname
    auth_basic "deepseek-chat";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

```sh
sudo certbot --nginx -d chat.example.com   # 自动补 443 与证书续期
```

---

## 5. Docker

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

## 6. 开发板（ARM Linux 单板机）

适用：树莓派 4/5、Orange Pi、Jetson 等跑 **Debian 系 arm64 系统**的板子。
后端依赖全部有 aarch64 预编译 wheel（requirements.txt 逐个锁版本），板子上**无需编译器**；
前端在电脑上构建好再上传，板子不需要 Node。

### 6.1 通用步骤（树莓派 Bookworm 等正常系统）

```sh
# 电脑上：构建前端
pnpm install && pnpm build

# 电脑上：上传（同网段可用主机名，树莓派默认 raspberrypi.local）
scp -r dist server requirements.txt starter.py 用户名@板子IP:~/deepseek-chat/

# 板子上：装后端并启动
cd ~/deepseek-chat
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port 8000
```

浏览器访问 `http://板子IP:8000`；常驻用第 3 节 systemd（改 WorkingDirectory 与
RequiresMountsFor），公网/局域网多设备访问加第 4 节 nginx。

### 6.2 Jetson Nano（2GB）专属步骤

JetPack 4.x 系统是 Ubuntu 18.04，自带 **Python 3.6** 且常见缺 ssl 模块（`No module named
'_ssl'`）——代码的 3.11 语法跑不了，pip 也无法联网装包。用 uv 绕开系统 Python：

```sh
# 电脑上：pnpm install && pnpm build，然后 scp 上传

# 板子上装 uv（纯 shell 下载，不依赖系统 Python）并创建独立 3.11 环境
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
cd ~/deepseek-chat        # 例：/mnt/usb/deepseek
uv venv --python 3.11 --seed .venv      # --seed 装入 pip，依赖安装与系统 3.6 无关
.venv/bin/pip install -r requirements.txt

# 启动（系统 python3 是 3.6，starter.py 必须用 .venv 里的解释器运行）
.venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port 8000
```

2GB 内存与运行注意：

- 依赖全部是预编译 aarch64 wheel，**不会触发大内存编译**；uvicorn 保持单进程，不要加
  `--workers`。JetPack 默认启用 zram swap，无需手动加。
- 服务只做存储代理，不碰 CUDA / JetPack 机器学习组件。
- 其余（SD 卡磨损、DATA_DIR、访问口令）见 6.4。

### 6.3 板子上 systemd + nginx 组合（U 盘布局可直接粘贴）

```ini
# /etc/systemd/system/deepseek-chat.service
[Unit]
Description=deepseek-chat storage backend
After=network.target local-fs.target
# 项目在 U 盘/移动盘上时必须等挂载就绪，否则开机自启会因目录不存在而失败
RequiresMountsFor=/mnt/usb/deepseek

[Service]
WorkingDirectory=/mnt/usb/deepseek
ExecStart=/mnt/usb/deepseek/.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3
User=xiaodi
Environment=DATA_DIR=/mnt/usb/deepseek/data
# Environment=ACCESS_PASSWORD=change-me

[Install]
WantedBy=multi-user.target
```

nginx 配置与启用命令见第 4 节（4.1 全转发最省心；4.2 需要注意 root 与权限）。启用：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now deepseek-chat
sudo ln -sf /etc/nginx/sites-available/deepseek-chat /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
# 局域网验证：浏览器打开 http://板子IP/ 与 http://板子IP/api/health
```

### 6.4 板子特有的注意事项

- **Python 版本**：Bookworm 自带 3.11 可直接用；Bullseye（3.9）与 JetPack（3.6）需要 uv
  准备 3.11（见 6.2），或至少用 6.5 的离线轮子方案。代码已兼容 3.9 运行时，但 uvicorn
  等依赖在缺 ssl 的自编译 Python 上无法导入，**自编译 Python 基本不可用**。
- **存储介质**：默认 `data/` 在 SD 卡上，SQLite WAL 长期写入有磨损；插 SSD/NVMe 时用
  `DATA_DIR=/mnt/ssd/deepseek-chat/data` 指过去。
- **U 盘文件系统**：exFAT / FAT32 上 WAL 不可用、权限位不完整——建议格式化为 ext4，
  或把 DATA_DIR 指到 ext4 位置。
- **内存**：512MB 即可运行（uvicorn 单进程 + SQLite）；GZip 已内置。
- **DeepSeek API Key**：请求由各访问者的浏览器直发，板上不需要配置任何 Key。
- **公网/多人访问**：务必配 `ACCESS_PASSWORD`（`.env` 或 systemd Environment）。

### 6.5 离线安装（板子没网 / Python 缺 ssl）

电脑上按板子平台下载轮子，离线装入：

```sh
# 电脑上（按板子解释器版本改 --python-version）：
pip download -r requirements.txt --only-binary=:all: \
  --platform manylinux2014_aarch64 --platform manylinux_2_28_aarch64 \
  --python-version 3.11 -d wheelhouse
scp -r wheelhouse 用户名@板子IP:~/deepseek-chat/

# 板子上：
.venv/bin/python -m pip install --no-index --find-links wheelhouse -r requirements.txt
```

---

## 7. 数据与运维

- **备份**：停服后复制 `data/chats.db`（附件原件也在其中）；`DATA_DIR` 环境变量可改位置。
- **环境变量**：复制 `.env.example` 为 `.env` 即可配置数据目录与访问口令（`ACCESS_PASSWORD`），
  `starter.py` 与 uvicorn 都会自动读取；模板见 [.env.example](.env.example)。
- **升级**：`git pull` → 重新 `pnpm build`（或上传新 dist）→ 重启服务；SQLite 数据不受影响。
- **日志**：uvicorn 输出在 systemd journal（`journalctl -u deepseek-chat`）或容器日志里。
- **多用户语义**：当前是单库共享模型。要每人独立历史，需要新增用户体系（较大改动，尚未实现）。

---

## 8. 踩坑 FAQ（均为实际出现过的错误）

**Q1：pip 报 `UnicodeDecodeError: 'gbk' codec can't decode ...`？**
中文 Windows（GBK 本地编码）下 pip 按「系统编码」读 requirements 文件。本仓库的
requirements.txt 首行已带 `# -*- coding: utf-8 -*-` 声明（pip 会优先识别）；
若自己重写该文件，务必保留首行。顺手升级老 pip：`python -m pip install --upgrade pip`。

**Q2：pip 报 `WARNING: ... ssl module in Python is not available` / `No module named '_ssl'`？**
系统 Python 编译时没带 ssl（自编译 / 厂商镜像常见）。pip 无法做任何 HTTPS 下载。
解法：用 uv 准备自带 ssl 的独立解释器（见 6.2），或走 6.5 离线轮子。

**Q3：`No module named server.starter`？**
没有这个模块。`starter.py` 是根目录脚本（`python starter.py`），应用入口是
`server.app:app`（`python -m uvicorn server.app:app`）。

**Q4：`ERROR: Could not open requirements file: [Errno 2] No such file or directory`？**
scp 漏传。核对板子上 `ls` 应有 `dist/ server/ requirements.txt starter.py`。

**Q5：nginx 反代后 `/api/*` 全部 404？**
`proxy_pass http://127.0.0.1:8000/;` 结尾带了斜杠——nginx 会把 location 前缀
（`/api/`）剥掉再转发，后端收到的是 `/sessions`。去掉结尾斜杠即可。

**Q6：nginx 出静态时页面 403 / 静态资源 404？**
dist 目录权限（`sudo chmod -R a+rX dist`）；root 要定义在 server 层（location 内的
root 不会被正则 location 继承）。

**Q7：切换了依赖目录（PYTHONPATH）后报 `No module named 'pydantic_core._pydantic_core'`？**
PYTHONPATH 里的旧版依赖（为别的解释器版本编译）遮蔽了 venv 的 site-packages。
`unset PYTHONPATH`（并清理 .bashrc），只用 venv 一套环境。

**Q8：板子重启后服务没起来？**
项目在 U 盘上但 unit 没等挂载：加 `RequiresMountsFor=/mnt/usb/deepseek`；
U 盘挂载点变化的话在 /etc/fstab 固定。

**Q9：`systemctl start` 报 `address already in use`？**
之前在终端里手动跑的 uvicorn 还占着 8000。Ctrl+C 停掉它，或
`sudo pkill -f "uvicorn server.app"`，再 `systemctl start`。
之后统一用 systemd 管理，别再开第二个实例。

---

## 9. 部署后验证清单

任意形态部署完成后逐条过一遍：

```sh
curl -I http://<地址>/api/health          # 200 + {"ok":true,...}
curl -I http://<地址>/                    # 200，内容是 index.html（前端页面）
curl -I http://<地址>/static/$(ls dist/static/js | head -1 | sed 's|^|js/|')
                                          # 200 + Cache-Control（immutable 或 30d）
```

浏览器侧：

- 打开首页能正常聊天，回复**逐字流式**出现（SSE 未被缓冲）；
- 刷新页面会话恢复；上传图片附件成功且重载后仍在；
- 配置了 `ACCESS_PASSWORD` 时，首次访问弹出口令输入门；
- nginx + HTTPS 形态下，浏览器地址栏可安装 PWA（安全上下文才生效）。
