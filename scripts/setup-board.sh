#!/usr/bin/env bash
# 开发板一键部署：仅 Python 服务（uvicorn 托管前端 + API），systemd 自启动
# 用法（在板子上）：sudo bash scripts/setup-board.sh
# 可用环境变量覆盖默认值：
#   PROJECT_DIR=/mnt/usb/deepseek   项目根目录（含 .env 与 server/）
#   PYTHON_BIN=$PROJECT_DIR/.venv/bin/python  解释器路径（非标准布局如 python_libs 时覆盖）
#   UI_DIR=$PROJECT_DIR/dist        前端产物目录（板子上叫 ui 时覆盖）
#   SERVICE_USER=xiaodi             服务运行用户
#   BACKEND_PORT=8000               服务监听端口（0.0.0.0 对局域网开放）
# 幂等：重复执行会覆盖 unit，但会先备份原文件；本脚本等价于 DEPLOY.md 6.3 的手工步骤。
# 不装 nginx：uvicorn 直接对外；需要 nginx 反代时见 DEPLOY.md 第 4 节。
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/mnt/usb/deepseek}"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-xiaodi}}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
PYTHON_BIN="${PYTHON_BIN:-$PROJECT_DIR/.venv/bin/python}"
UI_DIR="${UI_DIR:-$PROJECT_DIR/dist}"
ENV_FILE="$PROJECT_DIR/.env"
UNIT_FILE=/etc/systemd/system/deepseek-chat.service

say() { echo "[setup-board] $*"; }
die() { echo "[setup-board] ✗ $*" >&2; exit 1; }
# 健康探测：优先 curl，没有 curl 就用项目解释器（urlopen 非 2xx 会抛错）
probe_health() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 2 "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1
  else
    "$PYTHON_BIN" -c "import urllib.request as u; u.urlopen('http://127.0.0.1:$BACKEND_PORT/api/health', timeout=2)" >/dev/null 2>&1
  fi
}

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行：sudo bash scripts/setup-board.sh"
[ -x "$PYTHON_BIN" ] || die "缺少解释器 $PYTHON_BIN —— 用 PYTHON_BIN=... 指定（如 python_libs/bin/python）"
[ -d "$PROJECT_DIR/server" ] || die "缺少 $PROJECT_DIR/server —— 检查 PROJECT_DIR 是否正确"
getent passwd "$SERVICE_USER" >/dev/null || die "用户 $SERVICE_USER 不存在"

# .env 是模型 Key 的唯一来源。校验直接复用 server.config 的解析与占位符判定，
# 避免 shell 正则与 Python 规则不一致导致「脚本通过但服务不可用」。
[ -f "$ENV_FILE" ] || die "缺少 $ENV_FILE —— 先 cp .env.example .env 并填入 DEEPSEEK_API_KEY"
key_status=$(
  cd "$PROJECT_DIR" && "$PYTHON_BIN" -c \
    'from server import config; print(config.DEEPSEEK_KEY_SOURCE)' 2>/dev/null
) || key_status='error'
case "$key_status" in
  env) ;;
  placeholder)
    die "$ENV_FILE 里的 DEEPSEEK_API_KEY 还是示例值 —— 请替换成真实 Key" ;;
  *)
    die "$ENV_FILE 里没有有效的 DEEPSEEK_API_KEY（或 Python 校验失败：$key_status）" ;;
esac
# systemd 的 EnvironmentFile 不支持 `export ` 前缀（Python 解析器支持，容易漏判）
if grep -qE '^[[:space:]]*export[[:space:]]+DEEPSEEK_API_KEY=' "$ENV_FILE"; then
  die "$ENV_FILE 的 DEEPSEEK_API_KEY 带了 export 前缀 —— systemd EnvironmentFile 不认，请去掉"
fi

# 1) .env 权限收紧：Key 明文，只允许服务用户读取
say "收紧 .env 权限（600，$SERVICE_USER）..."
chmod 600 "$ENV_FILE"
chown "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" "$ENV_FILE"

# 2) systemd unit：开机自启 + 崩溃拉起；U 盘布局时等挂载就绪。
# 用 EnvironmentFile 读 .env，不把 Key 写进 unit（unit 默认 0644 会被任意本地用户读到）。
# 不硬写 DATA_DIR：交给 .env 决定，避免环境变量优先级压过 .env 里的 SSD 路径。
say "写入 systemd unit：$UNIT_FILE"
if [ -f "$UNIT_FILE" ]; then
  cp "$UNIT_FILE" "$UNIT_FILE.bak"
  say "已备份原 unit 到 $UNIT_FILE.bak"
fi
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
ExecStart=$PYTHON_BIN -m uvicorn server.app:app --host 0.0.0.0 --port $BACKEND_PORT
Restart=always
RestartSec=3
User=$SERVICE_USER
EnvironmentFile=$ENV_FILE

[Install]
WantedBy=multi-user.target
EOF

# 3) 前端产物对服务用户可读
if [ -d "$UI_DIR" ]; then
  chmod -R a+rX "$UI_DIR" 2>/dev/null || true
else
  say "警告：$UI_DIR 不存在 —— 页面可能无法访问（用 UI_DIR=... 指定实际目录）"
fi

# 4) 清理此前一键脚本创建的 nginx 站点（如有），避免两套入口混淆
if [ -e /etc/nginx/sites-enabled/deepseek-chat ]; then
  say "移除旧的一键脚本 nginx 站点（只保留 Python 服务）..."
  rm -f /etc/nginx/sites-enabled/deepseek-chat /etc/nginx/sites-available/deepseek-chat
  if command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  fi
fi

# 5) 停掉旧实例再启动：systemd 管理的与终端手动跑的 uvicorn 都会占用端口，
#    不清理会导致 restart 失败（address already in use）或新实例起不来
say "停止旧实例 ..."
systemctl stop deepseek-chat 2>/dev/null || true
pkill -f 'uvicorn server.app:app' 2>/dev/null || true
for _ in $(seq 1 20); do
  pgrep -f 'uvicorn server.app:app' >/dev/null 2>&1 || break
  sleep 0.25
done
if pgrep -f 'uvicorn server.app:app' >/dev/null 2>&1; then
  say "优雅停止超时，强制结束 ..."
  pkill -9 -f 'uvicorn server.app:app' 2>/dev/null || true
  sleep 1
fi

# 6) 启用服务
say "启用 systemd 服务 ..."
systemctl daemon-reload
systemctl enable deepseek-chat >/dev/null
systemctl restart deepseek-chat

# 7) 健康检查：确认新实例真的起来了，而不是留给用户自己去撞 404
say "等待服务就绪 ..."
ready=false
for _ in $(seq 1 40); do
  if probe_health; then ready=true; break; fi
  sleep 0.5
done
if [ "$ready" != true ]; then
  die "服务未就绪 —— 查看日志定位：journalctl -u deepseek-chat -n 50"
fi
say "服务已就绪 ✓（health 探测通过）"

# 8) 结果摘要
board_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
say "────────────────────────────────────────────"
say "部署完成 ✓（仅 Python 服务，无 nginx）"
say "  服务状态：systemctl status deepseek-chat"
say "  本机验证：curl http://127.0.0.1:$BACKEND_PORT/api/health"
say "  局域网  ：http://${board_ip:-<板子IP>}:$BACKEND_PORT/   （前端页面与 /api 同端口）"
say "  日志    ：journalctl -u deepseek-chat -f"
say "  注意    ：健康响应里的 deepseek 字段应为 true，否则模型调用会失败"
say "────────────────────────────────────────────"
