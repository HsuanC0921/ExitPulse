#!/usr/bin/env bash
# 為 API 建立唯讀資料庫角色，讓 API 不再用 PostgreSQL 超級使用者連線。
# 這個腳本可重複執行：已存在的角色只會更新密碼與權限。匯入工具仍使用 .env 的 POSTGRES_USER。
# 用法（專案根目錄）：./deploy/create-readonly-role.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.prod.yml")

set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

ROLE="${EXITPULSE_API_USER:-exitpulse_api}"
PASSWORD="${EXITPULSE_API_PASSWORD:-$(openssl rand -hex 24)}"
OWNER="${POSTGRES_USER:-exitpulse}"
DB="${POSTGRES_DB:-exitpulse}"

"${COMPOSE[@]}" exec -T db psql -U "$OWNER" -d "$DB" -v ON_ERROR_STOP=1 \
  -v role="$ROLE" -v pw="$PASSWORD" -v owner="$OWNER" -v db="$DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'role') \gexec
-- 現有的所有 schema（每個月份一個）
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'role') FROM pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', nspname, :'role') FROM pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
-- 之後匯入新月份時，擁有者建立的 schema 與資料表會自動授權
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT USAGE ON SCHEMAS TO %I', :'owner', :'role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT SELECT ON TABLES TO %I', :'owner', :'role') \gexec
SQL

upsert() {
  local key="$1" value="$2" file="$ROOT/.env"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
upsert EXITPULSE_API_USER "$ROLE"
upsert EXITPULSE_API_PASSWORD "$PASSWORD"
chmod 600 "$ROOT/.env"

echo "已建立唯讀角色 ${ROLE}，並寫入 .env。執行下列指令讓 API 改用它："
echo "  docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d api"
