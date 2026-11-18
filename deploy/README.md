# ExitPulse 正式環境自行架設指南

這份手冊說明如何在全新的 Linux 主機上，從零部署 PostgreSQL 18、FastAPI 後端、Angular 靜態前端與 Caddy HTTPS 反向代理。以下指令皆在專案根目錄執行。

## 系統需求

- Docker Engine、Docker Compose v2 與 Git
- Node.js 22.22.3 以上的 22.x、24.15.0 以上的 24.x 或 26.x，用來建置前端。可在另一台電腦建置後再上傳。[Angular 版本需求](https://angular.dev/reference/versions)
- 若要連上公網，準備指向主機的網域、可供外部連線的 80／443 埠，以及主機端的 Caddy 2。
- 磁碟需同時容納 PostgreSQL、下載的原始資料和 Docker 映像。117 個月的正式 PostgreSQL 約 17 GiB，從公開資料建庫還需另外預留下載和匯入空間。

```sh
git clone https://github.com/HsuanC0921/ExitPulse.git
cd ExitPulse
```

## 1. 準備 `.env` 設定

將 `.env.example` 複製為 `.env` 並設為僅擁有者可讀（`0600`），填入獨立的強密碼：

```sh
cp .env.example .env
chmod 600 .env
```

`.env` 與 [docker-compose.prod.yml](docker-compose.prod.yml) 支援的環境變數：

| 變數名稱 | 預設值 | 說明 |
| --- | --- | --- |
| `POSTGRES_USER` | `exitpulse` | PostgreSQL 帳號 |
| `POSTGRES_DB` | `exitpulse` | 資料庫名稱 |
| `POSTGRES_PASSWORD` | （必填） | PostgreSQL 密碼，未設定時 Compose 會拒絕啟動 |
| `EXITPULSE_WEB_PORT` | `5080` | Caddy 容器綁定在本機 `127.0.0.1` 的 HTTP 埠 |
| `EXITPULSE_WEB_RELEASES` | `/srv/exitpulse/releases` | 主機存放前端建置產物與 `current` 符號連結的目錄 |
| `EXITPULSE_WORKERS` | `2` | API 分析行程池大小 |
| `EXITPULSE_PLACES_ENDPOINT` | `https://photon.komoot.io/api/` | 地點搜尋上游 API 端點 |

> 正式 Compose 使用獨立命名的資料卷 `exitpulse-pg18` 掛載 PostgreSQL 18，若主機已有其他版本的 PostgreSQL 容器，請勿共用舊資料卷。

## 2. 獨立建置前端靜態檔

進入 `apps/web` 建置正式版前端，將編譯產物放入 `${EXITPULSE_WEB_RELEASES}/<release>`，並建立**相對路徑**的符號連結 `current`（確保掛載進容器 `/srv/web` 後仍可解析）：

```sh
cd apps/web
npm ci
npm run build
cd ../..

RELEASE="$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p "/srv/exitpulse/releases/${RELEASE}"
sudo cp -r apps/web/dist/web/browser/. "/srv/exitpulse/releases/${RELEASE}/"
sudo ln -sfn "${RELEASE}" /srv/exitpulse/releases/current
```

## 3. 啟動 PostgreSQL 18 與初始化資料

先啟動 PostgreSQL 並建置 API 映像。API 的就緒檢查需要已匯入的月份資料，因此服務會在下一步才啟動。

```sh
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --wait db
docker compose --env-file .env -f deploy/docker-compose.prod.yml build api
```

接著選擇以下任一方式填入資料：

### 路線 A：從零由公開資料自動建庫（無需既有備份）

用一次性容器執行 [setup.py](../tools/setup.py)。它會下載近 12 個月的旅次、匯入車站資料，再驗證指定的月份。下載快取保留在專案的 `data/`，中斷後可以重跑。

```sh
mkdir -p data
docker compose --env-file .env -f deploy/docker-compose.prod.yml run --rm --no-deps \
  --volume "$PWD/data:/app/data" api \
  sh -c 'EXITPULSE_DATABASE_URL="host=$PGHOST user=$PGUSER dbname=$PGDATABASE" exec python tools/setup.py "$@"' setup --jobs 1
```

要匯入 2017-01 起的所有月份，在 `setup --jobs 1` 後加 `--all`。也可在 `setup` 後指定明確的起訖月份，例如 `setup 2025-01 2026-09 --jobs 1`。站區人口與部分輔助資料可在建庫後依[更新手冊](../docs/AUTO_UPDATE.md)補齊。

### 路線 B：由自備的 PostgreSQL 18 `pg_dump` 備份還原

若你已有本機匯出的自定格式備份（例如 `pg_dump -Fc --compress=zstd:3`），可將檔案透過標準輸入還原到剛建好的空白 `db` 容器：

```sh
docker compose --env-file .env -f deploy/docker-compose.prod.yml exec -T db \
  sh -c 'exec pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < exitpulse.dump

docker compose --env-file .env -f deploy/docker-compose.prod.yml exec -T db \
  sh -c 'exec vacuumdb --analyze-only -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## 4. 啟動 Web 容器與設定 HTTPS

資料備妥後啟動 API 與 Web 容器。[Caddyfile](Caddyfile) 負責靜態頁、壓縮和 API 代理。

```sh
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --wait api web
```

在主機端 Caddy 設定你的網域，將外部 HTTPS 流量轉發到 `127.0.0.1:5080`。如果更改了 `EXITPULSE_WEB_PORT`，代理埠也要同步修改。

```caddyfile
exitpulse.example.com {
	reverse_proxy 127.0.0.1:5080
}
```

驗證主機端 Caddy 設定並重新載入：

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 5. 上線後驗收

確認後端就緒，並用已匯入的月份查一次全線人次。下例的月份和網域要換成你的設定。

```sh
curl --fail http://127.0.0.1:5080/health
curl --fail http://127.0.0.1:5080/ready
curl --fail https://exitpulse.example.com/api/v1/od/months
curl --fail 'https://exitpulse.example.com/api/v1/od/network?period=2026-09'
```

從公開資料建庫時，`setup.py` 已驗證所選區間。從備份還原時，可在 API 容器內跑 `python tools/verify_od.py 起始月份 結束月份`。如果匯入了專案完整歷史資料，也可在主機用 `python3 tools/smoke.py --api https://exitpulse.example.com --web https://exitpulse.example.com` 跑固定月份的回歸檢查。

最後請使用桌機與手機瀏覽器實際開啟 `https://exitpulse.example.com`，確認：
- 向量底圖載入完成且縮放、深淺主題與 3D 立體視角正常切換
- 兩站比較、單站逐時查詢與站區卡片（YouBike、人口、周邊設施）顯示正常

## 版本回滾與定期自動更新

- **前端秒級回滾**：將 `/srv/exitpulse/releases/current` 指回上一個 `<release>` 目錄即可（若含後端 API 異動則須一併切回對應 Git 版本並重跑 `up -d --build api`）。
- **每月／每週自動更新**：[systemd](systemd) 目錄附有每月 OD 更新與每週輔助資料更新的 unit 範本，詳細排程與警戒機制見 [docs/AUTO_UPDATE.md](../docs/AUTO_UPDATE.md)。
