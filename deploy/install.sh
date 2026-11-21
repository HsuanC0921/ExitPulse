#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMPORT_ALL=0
WITH_METRO_MAP=0
SKIP_BUILD=0
NO_TIMERS=0
CUSTOM_PORT=""
CUSTOM_RELEASES=""

usage() {
  cat <<'EOF'
ExitPulse 零前置一鍵部署工具

用法：
  ./deploy/install.sh [選項]

選項：
  --all             從 2017-01 匯入完整歷史月份（預設匯入最近 12 個月）
  --port=PORT       設定本機 Web 容器監聽埠（預設 5080）
  --releases=DIR    設定前端靜態檔釋出目錄（預設 /srv/exitpulse/releases）
  --with-metro-map  建庫時一併從 OSM Overpass 重抓最新捷運路網 GeoJSON
  --skip-build      略過前端 Angular 編譯（僅重跑資料庫／服務／排程安裝）
  --no-timers       不安裝 systemd 自動更新排程
  -h, --help        顯示說明
EOF
}

for arg in "$@"; do
  case "$arg" in
    --all) IMPORT_ALL=1 ;;
    --with-metro-map) WITH_METRO_MAP=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-timers) NO_TIMERS=1 ;;
    --port=*) CUSTOM_PORT="${arg#--port=}" ;;
    --releases=*) CUSTOM_RELEASES="${arg#--releases=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知參數：$arg" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "錯誤：需要安裝 Docker Engine 與 Docker Compose v2。" >&2
  exit 1
fi

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36
  fi
}

upsert_env() {
  local key="$1" val="$2" file="$3"
  if grep -qE "^#?\s*${key}=" "$file"; then
    sed -i.bak -E "s|^#?\s*${key}=.*|${key}=${val}|" "$file"
    rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$val" >>"$file"
  fi
}

echo "== 1/6 檢查或建立 .env 設定"
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi
chmod 600 "$ROOT/.env"

set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  upsert_env "POSTGRES_PASSWORD" "$(gen_secret)" "$ROOT/.env"
fi
if [ -n "$CUSTOM_PORT" ]; then
  upsert_env "EXITPULSE_WEB_PORT" "$CUSTOM_PORT" "$ROOT/.env"
fi
if [ -n "$CUSTOM_RELEASES" ]; then
  upsert_env "EXITPULSE_WEB_RELEASES" "$CUSTOM_RELEASES" "$ROOT/.env"
fi

set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

chmod +x "$ROOT/deploy/update-all.sh" "$ROOT/deploy/install.sh"

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "== 2/6 建置並發布前端靜態檔"
  "$ROOT/deploy/update-all.sh" web
else
  echo "== 2/6 略過前端建置（--skip-build）"
fi

COMPOSE_FILE="$ROOT/deploy/docker-compose.prod.yml"
echo "== 3/6 啟動 PostgreSQL 18 並建置 API 映像"
docker compose --env-file "$ROOT/.env" -f "$COMPOSE_FILE" up -d --wait db
docker compose --env-file "$ROOT/.env" -f "$COMPOSE_FILE" build api

echo "== 4/6 零前置自動建庫（建立 UTF-8 資料庫、匯入旅次與輔助資料）"
INIT_ARGS=()
if [ "$IMPORT_ALL" -eq 1 ]; then
  INIT_ARGS+=(--all)
fi
if [ "$WITH_METRO_MAP" -eq 1 ]; then
  INIT_ARGS+=(--update-map)
fi
"$ROOT/deploy/update-all.sh" init "${INIT_ARGS[@]}"

echo "== 5/6 啟動 API 與 Web 服務並驗證就緒狀態"
docker compose --env-file "$ROOT/.env" -f "$COMPOSE_FILE" up -d --wait api web

PORT="${EXITPULSE_WEB_PORT:-5080}"
READY_OK=0
for _ in $(seq 1 30); do
  if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${PORT}/ready" >/dev/null 2>&1; then
    READY_OK=1
    break
  fi
  sleep 2
done
if [ "$READY_OK" -eq 0 ]; then
  echo "警告：http://127.0.0.1:${PORT}/ready 尚未通過，請檢查 docker compose logs api web。" >&2
fi

if [ "$NO_TIMERS" -eq 0 ]; then
  echo "== 6/6 安裝每月旅次與每週輔助資料自動更新排程"
  if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
    SUDO_CMD=""
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
      SUDO_CMD="sudo"
    fi
    for svc in exitpulse-monthly exitpulse-aux; do
      TMP_SVC="$(mktemp)"
      sed "s|/opt/exitpulse|${ROOT}|g" "$ROOT/deploy/systemd/${svc}.service" >"$TMP_SVC"
      $SUDO_CMD cp "$TMP_SVC" "/etc/systemd/system/${svc}.service"
      $SUDO_CMD cp "$ROOT/deploy/systemd/${svc}.timer" "/etc/systemd/system/${svc}.timer"
      rm -f "$TMP_SVC"
    done
    $SUDO_CMD systemctl daemon-reload
    $SUDO_CMD systemctl enable --now exitpulse-monthly.timer exitpulse-aux.timer
    echo "已啟用 systemd 定期自動更新排程（exitpulse-monthly.timer、exitpulse-aux.timer）。"
  else
    echo "此系統未使用 systemd，可於 crontab -e 加入以下兩行定期自動更新："
    echo "30 3 * * * ${ROOT}/deploy/update-all.sh monthly >> ${ROOT}/data/monthly-update.log 2>&1"
    echo "15 4 * * 0 ${ROOT}/deploy/update-all.sh aux >> ${ROOT}/data/aux-update.log 2>&1"
  fi
else
  echo "== 6/6 略過自動更新排程安裝（--no-timers）"
fi

echo ""
echo "部署完成！本機入口：http://127.0.0.1:${PORT}"
echo "後續若要更新程式與重建前後端，只需執行：./deploy/update-all.sh upgrade"
