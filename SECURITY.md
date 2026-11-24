# 資安現況與審查紀錄

ExitPulse 是沒有帳號登入的公開唯讀服務，攻擊面集中在 API、資料庫與部署層。2026-11-24 完成一輪完整審查，核心取捨的詳細評估與代價見 [docs/DECISIONS.md](docs/DECISIONS.md#2026-11-24-資安的三個取捨)。

## 已落實的縱深防禦

### 應用與輸入防線
- **SQL 全部參數化**：查詢值一律走 `%s` 佔位符，識別字使用 `sql.Identifier`，動態組合片段僅含常數與佔位符。分析於行程池內直接呼叫函式，不經 shell。
- **入口輸入驗證**：月份、日期、站名長度、時段與日型都在入口驗證，站名禁止以 `-` 開頭避免被解析為命令列選項。驗證失敗統一回 400，且只回固定錯誤訊息，不附堆疊。
- **前端安全邊界**：沒有使用 `innerHTML`、`bypassSecurityTrust` 或 `eval`。`localStorage` 僅存介面偏好與收藏，不含權杖。匯入分享連結會檢查格式，並有測試擋掉外部網址與 `javascript:`。
- **正式環境關閉文件端點**：線上以 `EXITPULSE_DOCS=0` 關閉 `/docs` 與 `/openapi.json`，本機開發預設仍開啟。

### 流量與標頭防護
- **單一來源 IP 速率限制**：預設每分鐘 240 次、瞬間 80 次，超量回 429 並附 `Retry-After`，同時寫入 `Rate limit exceeded` 警告日誌（同一 IP 每 60 秒最多記一筆）。只在直連對端屬內網反向代理時才採信 `X-Forwarded-For`，避免用戶端偽造。可透過 `EXITPULSE_RATE_PER_MINUTE` 與 `EXITPULSE_RATE_BURST` 調整，設 `0` 關閉。
- **資源與查詢上限**：設有查詢逾時 30 秒、資料庫語句逾時、排隊滿載回 429 與快取上限，地點搜尋全域限速每秒 1 次。
- **傳輸與安全標頭**：外層主機 Caddy 送出 HSTS 與 `X-Frame-Options: DENY`（範例見 [deploy/README.md](deploy/README.md)），容器內 Caddy 送出 `Permissions-Policy`、`nosniff` 與 `Referrer-Policy`。CSP 僅放行本站、`tiles.openfreemap.org` 與 `wmts.nlsc.gov.tw`，並設 `object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'none'`，已用正式建置實際載入地圖驗證無違規。

### 容器、密鑰與供應鏈
- **最小權限容器與網路隔離**：API 以非 root 的 `app` 身分（數字 UID）執行，移除所有 Linux capability 並禁止提權。Caddy 檔案系統唯讀。資料庫不對外開埠，網頁容器僅綁定 `127.0.0.1`。
- **密鑰管理**：`.env` 與 `data/` 不進版本庫，`deploy/install.sh` 以 `openssl rand` 產生密碼並將 `.env` 權限設為 `600`。整份 git 歷史經掃描確認沒有金鑰、私鑰或 token。
- **CI 與相依套件鎖定**：GitHub Actions 外部元件一律固定到 commit SHA，`requirements.lock` 記錄通過 `pip-audit` 檢查的版本，Docker 建置以 `-c requirements.lock` 安裝。資料匯入工具與告警 webhook 只接受 `https`。

## 弱點掃描紀錄（2026-11-24）

2026-11-24 共執行 10 項掃描，每一筆告警都回到程式碼逐條確認是真問題還是誤報。相依套件（`npm audit`、`pip-audit`、`trivy`）與 shell 腳本均為 0 漏洞，僅餘 1 筆已知取捨（OWASP ZAP Medium：`style-src 'unsafe-inline'`）與人工確認過的誤報。

| 工具 | 檢查範圍 | 結果與處置 |
| --- | --- | --- |
| `npm audit` | 前端 npm 相依 | 0 個漏洞 |
| `pip-audit` | Python 相依與鎖定檔 | 沒有已知漏洞 |
| `bandit` | Python 程式碼 | `apps/api` 無發現。`tools/` 的 B608 經人工確認為誤報（僅拼接常數與佔位符），B310 已改為只接受 https |
| `semgrep`（`p/default` 規則集） | `apps/api`、`tools`、`deploy` | `apps/api` 無發現。`tools/` 的 `formatted-sql-query` 與 `dynamic-urllib-use-detected` 經人工確認為誤報，SQL 值皆走 `%s` 參數，網址為固定常數或已限定 https |
| `shellcheck` | `deploy/*.sh` | 無警告 |
| `gitleaks` 8.30.1 | 整份 git 歷史 | 1 筆誤報：`collection.ts` 的 `COLLECTION_KEY` 是 `localStorage` 鍵名，不是密鑰，已記在 `.gitleaksignore`。其餘無發現 |
| `trivy` 0.76.2 | `deploy/` 設定、前端 `package-lock.json` | 0 個錯誤設定、npm 0 個漏洞、無密鑰。因 `trivy` 不辨識 `requirements.lock` 檔名，Python 相依改以 `pip-audit` 為準 |
| `hadolint` 2.15.1 | `deploy/Dockerfile.api` | 共 3 筆：`USER` 改數字 UID 與 `HEALTHCHECK` 改 JSON 格式已修。`apt-get install` 刻意不釘小版號以免 Debian 套件輪替造成建置失敗，已以 `hadolint ignore` 註記 |
| OWASP ZAP 2.17.0（蜘蛛加主動掃描） | 本機靜態站，帶與正式環境相同的 CSP（**未掃線上站台**） | Medium 1 筆：`style-src 'unsafe-inline'`，屬 Angular 與 MapLibre 行內樣式所需的已知取捨，尚未改 nonce。另有 2 筆資訊級（註解字樣、現代網頁應用偵測） |
| 正規表示式掃描 git 歷史 | token、私鑰、連線字串 | 只有本機開發用的預設密碼 |

**未執行項目**：`trivy image` 需要 Docker 常駐，本次本機未啟動因此未掃映像檔。OWASP ZAP 未對 API 動態掃描，因本機環境沒有資料庫。ZAP baseline 掃描僅限於自有測試環境，不對外部主機執行。

## 啟用唯讀資料庫角色

API 預設仍沿用擁有者帳號連線。要切換為唯讀角色，在主機專案根目錄執行一次即可：

```sh
./deploy/create-readonly-role.sh
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d api
```

腳本可重複執行，會建立 `exitpulse_api`、授予所有月份 schema 的唯讀權限，並設定後續新匯入月份自動授權，最後將帳密寫入 `.env`。匯入工具仍使用 `POSTGRES_USER`。

## 待改善項目

- 唯讀資料庫角色的腳本還沒在正式資料庫上實際執行，建議先在備份還原的環境試跑，再套用到正式環境。
- API 容器還不是唯讀檔案系統，匯入工具要寫入掛載目錄，要先確認不會影響才能開。
- CSP 的 `style-src` 仍含 `'unsafe-inline'`（ZAP Medium），要改成 nonce 需先處理 Angular 與 MapLibre 的行內樣式。
- 容器基底映像用浮動標籤，尚未固定到 `@sha256` 摘要。`requirements.lock` 也還沒有雜湊，可改用 `pip-compile --generate-hashes`。
- `systemd` 單元檔還沒有加固設定（`NoNewPrivileges`、`ProtectSystem` 等），需要先確認不會影響 `sudo` 與 Docker。
- git 歷史裡有本機開發用的預設連線字串，只綁 `127.0.0.1`，風險低，但不會改寫歷史。
- 地點搜尋會把使用者輸入的文字送到 `photon.komoot.io`，隱私說明還沒補上。

## 弱點回報

若發現安全問題，請透過 GitHub Security Advisories 私下回報，避免在修復前公開細節。
