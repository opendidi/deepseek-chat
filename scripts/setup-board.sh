#!/usr/bin/env bash
# 开发板一键部署：仅 Python 服务（uvicorn 托管前端 + API），systemd 自启动
# 用法（在板子上）：sudo bash scripts/setup-board.sh
# 可用环境变量覆盖默认值：
#   PROJECT_DIR=/mnt/usb/deepseek   项目根目录（含 .venv 与 dist/）
#   SERVICE_USER=xiaodi             服务运行用户
#   BACKEND_PORT=8000               服务监听端口（0.0.0.0 对局域网开放）
# 幂等：重复执行会覆盖配置并重启服务；本脚本等价于 DEPLOY.md 第 6.3 节的手工步骤。
# 不装 nginx：uvicorn 直接对外，前端页面与 /api 同端口；需要 nginx 反代时见 DEPLOY.md 第 4 节。
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/mnt/usb/deepseek}"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-xiaodi}}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
UNIT_FILE=/etc/systemd/system/deepseek-chat.service

say() { echo "[setup-board] $*"; }
die() { echo "[setup-board] ✗ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行：sudo bash scripts/setup-board.sh"
[ -x "$PROJECT_DIR/.venv/bin/python" ] || die "缺少 $PROJECT_DIR/.venv/bin/python —— 先按 DEPLOY.md 6.2 用 uv 创建环境"
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
ExecStart=$PROJECT_DIR/.venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port $BACKEND_PORT
Restart=always
RestartSec=3
User=$SERVICE_USER
Environment=DATA_DIR=$PROJECT_DIR/data
# Environment=ACCESS_PASSWORD=change-me

[Install]
WantedBy=multi-user.target
EOF

# 2) dist 对服务用户可读（服务通常就是该用户装的，多数情况本就满足）
chmod -R a+rX "$PROJECT_DIR/dist" 2>/dev/null || true

# 3) 清理此前一键脚本创建的 nginx 站点（如有），避免两套入口混淆
if [ -e /etc/nginx/sites-enabled/deepseek-chat ]; then
  say "移除旧的一键脚本 nginx 站点（只保留 Python 服务）..."
  rm -f /etc/nginx/sites-enabled/deepseek-chat /etc/nginx/sites-available/deepseek-chat
  if command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  fi
fi

# 4) 启用服务
say "启用 systemd 服务 ..."
systemctl daemon-reload
systemctl enable deepseek-chat >/dev/null
systemctl restart deepseek-chat

# 5) 结果摘要
board_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "────────────────────────────────────────────"
say "部署完成 ✓（仅 Python 服务，无 nginx）"
say "  服务状态：systemctl status deepseek-chat"
say "  本机验证：curl http://127.0.0.1:$BACKEND_PORT/api/health"
say "  局域网  ：http://${board_ip:-<板子IP>}:$BACKEND_PORT/   （前端页面与 /api 同端口）"
say "  日志    ：journalctl -u deepseek-chat -f"
say "────────────────────────────────────────────"
