#!/usr/bin/env bash
set -euo pipefail

# Polywise Ubuntu 部署脚本（无代码改动）
# 功能：检测/安装 Node.js + npm，安装依赖，生成必要目录与数据文件，并启动应用。

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-80}"

log() { printf "\033[1;32m[INFO]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m[ERR ]\033[0m %s\n" "$*"; }

need_sudo() {
  if [[ $EUID -ne 0 ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

check_command() {
  command -v "$1" >/dev/null 2>&1
}

install_node() {
  if check_command node && check_command npm; then
    return
  fi
  log "未检测到 Node.js 或 npm，使用 apt 安装 (nodejs npm)..."
  need_sudo apt update
  need_sudo apt install -y nodejs npm
}

ensure_node_version() {
  local min_major=18
  local cur
  cur=$(node -v | sed 's/^v//; s/\..*$//')
  if (( cur < min_major )); then
    warn "当前 Node.js 主版本低于 ${min_major}，建议升级。"
  fi
}

prepare_env() {
  if [[ ! -f "${APP_ROOT}/.env" ]]; then
    cat > "${APP_ROOT}/.env" <<'EOF'
# 必填：后台管理入口需要的 token
ADMIN_TOKEN=please-set-a-strong-token

# 可选：指定服务端口，默认 80
# PORT=80

# 可选：谷歌翻译 API Key
# GOOGLE_API_KEY=
EOF
    warn "已生成 .env 模板，请按需修改 ADMIN_TOKEN / PORT / GOOGLE_API_KEY。"
  fi
}

prepare_data_dirs() {
  mkdir -p "${APP_ROOT}/uploads"
  mkdir -p "${APP_ROOT}/data"
  [[ -f "${APP_ROOT}/data/articles.json" ]] || echo "[]" > "${APP_ROOT}/data/articles.json"
  [[ -f "${APP_ROOT}/data/topics.json" ]]   || echo "[]" > "${APP_ROOT}/data/topics.json"
}

install_dependencies() {
  log "安装生产依赖..."
  cd "${APP_ROOT}"
  npm install --production
}

start_app() {
  log "启动应用（前台）。如需后台常驻可自行用 tmux/screen/pm2/systemd 包裹。"
  cd "${APP_ROOT}"
  PORT="${PORT}" npm start
}

main() {
  log "工作目录: ${APP_ROOT}"
  install_node
  ensure_node_version
  prepare_env
  prepare_data_dirs
  install_dependencies

  log "准备完成。按需检查/编辑 .env 后再启动。"
  log "当前配置端口: ${PORT}"
  log "如需后台运行，可在终端执行：tmux new -s polywise 'PORT=${PORT} npm start'"
  # 默认直接前台启动
  start_app
}

main "$@"
