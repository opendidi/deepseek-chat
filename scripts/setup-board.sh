#!/usr/bin/env bash
# 开发板一键部署：systemd 自启动 + nginx 反代 + 前端静态托管
# 用法（在板子上）：sudo bash scripts/setup-board.sh
# 可用环境变量覆盖默认值：
#   PROJECT_DIR=/mnt/usb/deepseek   项目根目录（含 .venv 与 dist/）
#   SERVICE_USER=xiaodi             服务运行用户
#   BACKEND_PORT=8000               后端监听端口（nginx 转发目标）
# 幂等：重复执行会覆盖配置并重启服务；本脚本等价于 DEPLOY.md 第 6.3 节的手工步骤。
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/mnt/usb/deepseek}"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-xiaodi}}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
UNIT_FILE=/etc/systemd/system/deepseek-chat.service
NGINX_SITE=/etc/nginx/sites-available/deepseek-chat

say() { echo "[setup-board] $*"; }
die() { echo "[setup-board] ✗ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行：sudo bash scripts/setup-board.sh"
[ -x "$PROJECT_DIR/.venv/bin/python" ] || die "缺少 $PROJECT_DIR/.venv/bin/python —— 先按 DEPLOY.md 6.2 用 uv 创建环境"
[ -f "$PROJECT_DIR/dist/index.html" ] || die "缺少 $PROJECT_DIR/dist/index.html —— 先在电脑上 pnpm build 并上传 dist/"
getent passwd "$SERVICE_USER" >/dev/null || die "用户 $SERVICE_USER 不存在"

# 1) systemd unit：开机自启 + 崩溃拉起；U 盘布局时等挂载就绪
say "写入 systemd unit：$UNIT_FILE"
mount_line=''
case "$PROJECT_DIR" in
  /mnt/*|/media/*) mount_line="RequiresMountsFor=$PROJECT_DIR" ;;
esac
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=deepseek-chat storage backend
After=network.target local-fs.target
$mount_line

[Service]
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port $BACKEND_PORT
Restart=always
RestartSec=3
User=$SERVICE_USER
Environment=DATA_DIR=$PROJECT_DIR/data
Environment=SERVE_DIST=0
# Environment=ACCESS_PASSWORD=change-me

[Install]
WantedBy=multi-user.target
EOF

# 2) nginx：静态出 dist，/api 反代后端（proxy_pass 结尾不带斜杠；SSE 关缓冲）
if ! command -v nginx >/dev/null 2>&1; then
  say "未安装 nginx，尝试 apt 安装 ..."
  apt-get update -qq && apt-get install -y -qq nginx
fi
say "写入 nginx 站点：$NGINX_SITE"
cat > "$NGINX_SITE" <<'NGINX'
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 100m;   # 导入 / 附件上传的上限

    gzip on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;    # 结尾【不要】带斜杠，否则 /api 前缀被剥掉
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_buffering off;                 # 聊天回复是 SSE 流式，缓冲会卡住打字机效果
        proxy_read_timeout 300s;
    }

    location / {
        root __DIST_DIR__;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
NGINX
sed -i "s|__DIST_DIR__|$PROJECT_DIR/dist|" "$NGINX_SITE"

# 3) dist 对 nginx worker 可读（FAT/exFAT 上 chmod 是空操作，忽略报错）
chmod -R a+rX "$PROJECT_DIR/dist" 2>/dev/null || true

# 4) 启用服务
say "启用 systemd 服务 ..."
systemctl daemon-reload
systemctl enable deepseek-chat >/dev/null
systemctl restart deepseek-chat

say "启用 nginx 站点 ..."
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/deepseek-chat
if [ -e /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl restart nginx

# 5) 结果摘要
board_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "────────────────────────────────────────────"
say "部署完成 ✓"
say "  服务状态：systemctl status deepseek-chat"
say "  本机验证：curl http://127.0.0.1:$BACKEND_PORT/api/health"
say "  局域网  ：http://${board_ip:-<板子IP>}/"
say "  日志    ：journalctl -u deepseek-chat -f"
say "────────────────────────────────────────────"
