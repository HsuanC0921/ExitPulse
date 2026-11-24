#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

CMD="${1:-}"
if [ -z "$CMD" ]; then
  echo "用法：$0 {init|monthly|aux|map|web|upgrade} [額外參數...]" >&2
  exit 2
fi
shift

notify_failure() {
  local code="${1:-1}" cmd="${2:-unknown}" py=""
  [ "$code" -eq 0 ] && return 0
  if [ -x "$ROOT/.venv/bin/python" ]; then
    py="$ROOT/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    py="python3"
  elif command -v python >/dev/null 2>&1; then
    py="python"
  fi
  if [ -n "$py" ] && [ -f "$ROOT/tools/notify.py" ]; then
    "$py" "$ROOT/tools/notify.py" --title "ExitPulse 自動任務失敗（${CMD}）" --message "失敗指令：${cmd}（exit ${code}）" >/dev/null 2>&1 || true
  fi
}
trap 'notify_failure "$?" "$BASH_COMMAND"' ERR

RELEASES="${EXITPULSE_WEB_RELEASES:-/srv/exitpulse/releases}"
if [ -z "${EXITPULSE_DEFAULT_JSON:-}" ] && [ -d "$RELEASES/current/od" ]; then
  export EXITPULSE_DEFAULT_JSON="$RELEASES/current/od/default.json"
fi
if [ -z "${EXITPULSE_METRO_SYNC_DIR:-}" ] && [ -d "$RELEASES/current/metro" ]; then
  export EXITPULSE_METRO_SYNC_DIR="$RELEASES/current/metro"
fi

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -p "parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0
}

build_and_publish_web() {
  local need_sudo=""
  local release
  release="$(date +%Y%m%d-%H%M%S)"
  if [ "$(node_major)" -ge 22 ] && command -v npm >/dev/null 2>&1; then
    (cd "$ROOT/apps/web" && npm ci && npm run build)
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$ROOT/apps/web:/work" -w /work node:22-alpine sh -c "npm ci && npm run build"
  else
    echo "錯誤：建置前端需要 Node.js 22+ 或 Docker。" >&2
    exit 1
  fi
  if [ ! -w "$(dirname "$RELEASES")" ] && [ ! -w "$RELEASES" ]; then
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
      need_sudo="sudo"
    fi
  fi
  $need_sudo mkdir -p "${RELEASES}/${release}"
  $need_sudo cp -r "$ROOT/apps/web/dist/web/browser/." "${RELEASES}/${release}/"
  $need_sudo chmod -R a+rX "${RELEASES}/${release}"
  $need_sudo ln -sfn "${release}" "${RELEASES}/current"
  echo "已發布前端版本：${RELEASES}/${release}"
}

if [ "$CMD" = "map" ]; then
  exec node "$ROOT/tools/fetch-metro-osm.mjs" "$@"
fi
if [ "$CMD" = "web" ]; then
  build_and_publish_web
  exit 0
fi

PY_BIN=""
if [ -x "$ROOT/.venv/bin/python" ]; then
  PY_BIN="$ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PY_BIN="python"
fi

COMPOSE_FILE="$ROOT/deploy/docker-compose.prod.yml"
USE_DOCKER=0
if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ] && [ -f "$ROOT/.env" ]; then
  if docker compose --env-file "$ROOT/.env" -f "$COMPOSE_FILE" ps -q db 2>/dev/null | grep -q .; then
    USE_DOCKER=1
  fi
fi

run_py() {
  if [ "$USE_DOCKER" -eq 1 ]; then
    mkdir -p "$ROOT/data"
    docker compose --env-file "$ROOT/.env" -f "$COMPOSE_FILE" run --rm --no-deps --user root --cap-add DAC_OVERRIDE --cap-add CHOWN --cap-add FOWNER \
      -v "$ROOT/data:/app/data" \
      -v "$RELEASES:/srv/web" \
      -e "EXITPULSE_DATABASE_URL=postgresql://${POSTGRES_USER:-exitpulse}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-exitpulse}" \
      -e "EXITPULSE_DEFAULT_JSON=/srv/web/current/od/default.json" \
      -e "EXITPULSE_API_URL=${EXITPULSE_API_URL:-http://api:5011}" \
      api python -u "$@"
  elif [ -n "$PY_BIN" ]; then
    exec "$PY_BIN" -u "$@"
  else
    echo "找不到可用的 Docker db 容器或 Python 執行環境。" >&2
    exit 1
  fi
}

case "$CMD" in
  init)
    run_py tools/setup.py --jobs 1 "$@"
    ;;
  monthly)
    run_py tools/update_monthly.py "$@"
    ;;
  aux)
    run_py tools/update_auxiliary.py "$@"
    ;;
  upgrade)
    git -C "$ROOT" pull --ff-only
    build_and_publish_web
    if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ] && [ -f "$ROOT/.env" ]; then
      docker compose --env-file "$ROOT/.env" -f "$COMPOSE_FILE" up -d --build --wait api web
      PORT="${EXITPULSE_WEB_PORT:-5080}"
      if command -v curl >/dev/null 2>&1; then
        curl -fsS "http://127.0.0.1:${PORT}/ready" >/dev/null && echo "程式升級與服務就緒檢查通過（:${PORT}）。"
      fi
    fi
    ;;
  *)
    echo "不支援的子命令：$CMD（可用：init、monthly、aux、map、web、upgrade）" >&2
    exit 2
    ;;
esac
