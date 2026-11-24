# ExitPulse｜臺北捷運旅次變化雷達

![Version 1.5.1](https://img.shields.io/badge/version-1.5.1-1d2125)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Angular 22](https://img.shields.io/badge/Angular-22-dd0031)
![FastAPI](https://img.shields.io/badge/FastAPI-Python_3-009688)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)

**打開地圖，看臺北捷運的人從哪裡來、往哪裡去。** 以公開進出站資料比較兩站旅次消長、追蹤單站逐時人流，或以圓面積看全線進站規模。資料涵蓋 2017 年 1 月至 2026 年 9 月（共 117 個月），線上版位於 [exitpulse.150-230-109-154.sslip.io](https://exitpulse.150-230-109-154.sslip.io)。

**[線上體驗](https://exitpulse.150-230-109-154.sslip.io)** · [三種檢視](#三種檢視與操作) · [快速開始](#快速開始) · [系統架構](#系統架構) · [AI 開發與驗證](#我如何用-ai-開發並驗證) · [資安現況](#資安現況) · [文件導覽](docs/README.md)

![實站 16:9 桌機淺色：2022-09 與 2026-09 平日早尖峰站對變化比較、可收合右上工具列與流向弧線](docs/images/live-pairs-16x9.png)

## 為什麼做 ExitPulse

單看各站進出人次，只知道哪一站人多。把旅次的起點和終點連回地圖上，才看得見哪兩站往來最密、哪條動線在不同月份與時段出現消長。點開正式站可直接試這三個例子：

- **南港 → 南港展覽館**：比較 `2022-09` 與 `2026-09` 平日早尖峰，日均從 `770.7` 增至 `1,594.4` 人次。站卡旁列出周邊設施與 6 公里生活圈現住人口。
- **國父紀念館**：切到週末或 24 小時「環形指紋」，查看各時段進站分布與自動標出的爆量日。
- **全線上班日**：選「純工作日」依政府行事曆排除國定假日並納入補班日，比較各站日均進站人次，不被連假天數稀釋。

## 三種檢視與操作

桌機版採左面板、右地圖配置（視窗縮至 1100 px 以下展開明細不重疊），手機版以頂欄切換分頁、可摺疊浮層並支援加入主畫面。

| 檢視模式 | 看什麼 | 核心操作與分析 |
| --- | --- | --- |
| **兩站比較** | 兩期間哪幾對車站的往來變化最大 | 依占比變化、人次增減或成長率排行，可篩選日型、時段、路線與最低人次，變更條件即自動重查。「手選兩站」可用站名片段或站代號查榜外組合並對調起迄 |
| **單站往來** | 這一站的人從哪裡來、往哪裡去 | 點六線色塊或輸入站名／站代號（如 `BL12`、`R10`）按 Enter 切站。「比站」並列兩站曲線，附 24 小時環形指紋、站型判讀、距離分段、爆量日、重大事件註記與歷年走勢 |
| **全線人次** | 整個路網的人潮集中在哪裡 | 切換「進站量」（空心圓表當期、實心內圓表對照期）與「淨進出」（橘色淨流入、藍色淨流出，前 10 大站直接標人次）。含各站、每天、歷年、互搭表、榜單、紀錄六分頁 |

三種模式皆支援網址同步、`?embed=1` 嵌入模式、一鍵匯出 `1200×630` PNG 分享圖卡與相容 Excel 的 UTF-8 BOM CSV。地圖提供 OpenFreeMap「簡潔／詳圖」與國土測繪中心「臺灣地圖」即時切換、3D 立體地標視角、Photon 地名搜尋、日出日落漸變時間軸與車站出口沿革圖釘。

| 快捷鍵 | 動作 |
| --- | --- |
| `/` | 跳到當前檢視模式的搜尋欄 |
| `[` | 收合或展開左側面板 |
| `J` / `K` | 切換下一組／上一組站對 |
| `Space`、`←` / `→` | 單日時間軸播放／暫停、逐小時切換（焦點不在表單或地圖畫布時） |
| `Esc` | 關閉浮層或退出「只看地圖」 |

### 畫面預覽

| 單站往來與站區開放資料 | 全線各站進站規模 |
| --- | --- |
| ![單站往來：南港站往來排行、6 公里生活圈人口與周邊設施](docs/images/live-station-16x9.png) | ![全線人次：119 站進站規模圓面積與排行](docs/images/live-network-16x9.png) |

| 深色 3D 立體模式 | 手機：站對清單與詳情 |
| --- | --- |
| ![深色 3D 立體模式：臺北盆地夜色底圖與立體弧線](docs/images/live-3d-dark-16x9.png) | ![手機深色：站對詳情與歷年走勢](docs/images/mobile-detail-dark.png) |

## 快速開始

本機開發需要 Docker（或自備 UTF-8 PostgreSQL）、Python 3.13 與符合 [Angular 22 版本需求](https://angular.dev/reference/versions)的 Node.js。

### 1. 啟動資料庫並匯入預設資料

```bash
docker compose up -d --wait db
python -m pip install -r requirements.txt
python tools/setup.py
```

`tools/setup.py` 預設匯入最近 12 個月（單月連下載約 40 秒），完整匯入 2017-01 起請加 `--all`，也可指定區間（如 `2025-01 2026-09`）。若要清除重建 Docker 資料庫 volume 可跑 `docker compose down -v`（`data/` 內的原始檔會保留）。

### 2. 啟動 FastAPI 後端

```bash
# bash（PowerShell 請用 $env:EXITPULSE_DATABASE_URL = '...'）
export EXITPULSE_DATABASE_URL='postgresql://exitpulse:exitpulse@127.0.0.1:55432/exitpulse'
uvicorn main:app --app-dir apps/api --host 127.0.0.1 --port 5011
```

互動式 API 文件位在 [http://127.0.0.1:5011/docs](http://127.0.0.1:5011/docs)。建議綁在 `127.0.0.1`，避開 Windows `localhost` 優先嘗試 IPv6 造成的 2 秒逾時。

### 3. 啟動 Angular 前端

```bash
cd apps/web
npm ci
npx ng serve
```

打開 [http://localhost:4200/](http://localhost:4200/)，開發伺服器會自動把 `/api` 代理至 `127.0.0.1:5011`。

### 測試與正式部署

```bash
python -m unittest discover -s tests   # 後端單元與合約測試（未設 DB 連線時自動略過 31 項實庫測試）
npm --prefix apps/web test             # 前端單元測試
npm --prefix apps/web run build        # 正式建置
npm --prefix apps/web run test:e2e     # Playwright 瀏覽器煙霧測試（零 Console 錯誤）
```

在全新的 Linux 主機部署正式環境（需 Docker 與 Compose）：

```bash
./deploy/install.sh            # 產生 .env 密碼、編譯前端、建庫匯入並安裝 systemd 排程
./deploy/update-all.sh upgrade # 日後更新版本用
```

CI／Release 工作流程固定所有 GitHub Actions 至 commit SHA：推送 `main` 或 PR 時執行前後端測試、建置與弱掃（gitleaks、hadolint、pip-audit、`npm audit`），推送 `v*` 標籤時額外建置 Release 壓縮檔並透過受限強制指令的專用 SSH 金鑰自動部署 VPS。完整部署手冊見 [deploy/README.md](deploy/README.md)。

## 系統架構

```mermaid
flowchart LR
  subgraph src["資料來源"]
    A["臺北市資料大平臺<br/>OD 分時 CSV"]
    B["OpenStreetMap<br/>路線與車站"]
    C["政府公開資料與 Wikidata<br/>通車日、出口、景點、設施、假日曆"]
  end
  subgraph ops["自動排程與告警"]
    S["systemd 定時排程<br/>deploy/update-all.sh"]
    N["tools/notify.py<br/>Webhook / Telegram 失敗告警"]
  end
  subgraph etl["匯入與更新（tools/）"]
    D["setup.py / update_monthly.py<br/>import_od_range.py、import_od.py"]
    E["update_auxiliary.py<br/>build_ref.py、station_info.py"]
    J["fetch-metro-osm.mjs"]
  end
  DB[("PostgreSQL 18<br/>每月一個 schema<br/>加上 exitpulse_ref")]
  subgraph api["FastAPI（apps/api）"]
    F["/api/v1/od/*<br/>限速、快取與同鍵合併"]
    G["分析行程池<br/>query_od.py、analyze_od.py、leaders.py"]
  end
  H["Angular 22 與 MapLibre GL JS<br/>（apps/web）"]
  M["OpenFreeMap Positron / Liberty 3D<br/>國土測繪中心 WMTS · Photon 地點搜尋"]
  A --> D --> DB
  C --> E --> DB
  S --> D
  S --> E
  S --> J
  S -. "ERR trap 失敗告警" .-> N
  DB --> G --> F --> H
  B --> J -. "靜態檔 metro / releases" .-> H
  M -. 瀏覽器直接取用 .-> H
```

- **匯入與壓縮**：每月資料通過日期、時段與矩陣完整度驗證後才於單一交易內發布，逐時旅次採 `trip_groups` 分組陣列儲存（117 個月由 36.51 GiB 降至 4.15 GiB）。
- **查詢與併發保護**：API 透過常駐 Python 行程池執行分析，同鍵併發請求合併計算，排隊滿載回 429，逾時回 504。詳細端點規格與效能實測見 [docs/API.md](docs/API.md)。
- **核心文件**：所有規格與技術文件整理於 [docs/README.md](docs/README.md)，包含產品需求規格 [PRODUCT.md](PRODUCT.md)、設計規範 [DESIGN.md](DESIGN.md)、分析口徑與限制 [docs/METHODOLOGY.md](docs/METHODOLOGY.md) 與架構決策 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 我如何用 AI 開發並驗證

這個專案從頭到尾由我指揮 AI 工具完成，包含程式、測試與文件。以下只寫專案裡查得到的做法：

- **規格與規則寫成文件**：需求寫在 [PRODUCT.md](PRODUCT.md)（含需求編號與驗收條件），介面規則在 [DESIGN.md](DESIGN.md)，專案規範在 [CONTRIBUTING.md](CONTRIBUTING.md)。
- **小步提交與人工授權**：40 個以上 Conventional Commits 小步提交，推送、部署與刪除資料均須我明確授權。
- **跨工作階段接力靠文件**：[docs/PROGRESS.md](docs/PROGRESS.md) 記已驗證改動，[docs/NEXT.md](docs/NEXT.md) 收待辦，[docs/DECISIONS.md](docs/DECISIONS.md) 留取捨理由。
- **改動後一定跑測試**：後端 `python -m unittest discover -s tests` 目前 106 個通過、31 個因無資料庫略過，前端跑 `npm --prefix apps/web test` 與 `test:e2e` 煙霧測試。改寫為 FastAPI 時，曾拿舊 API 的 27 組回應當黃金樣本逐位元比對。
- **不信任 AI 的自我報告**：資安審查以 gitleaks、trivy、hadolint、bandit、semgrep、pip-audit 與本機 OWASP ZAP 實際掃描，每一筆告警皆回到程式碼逐條判讀真問題與誤報。
- **沒驗證的就如實標示**：尚未做過真人使用者測試，唯讀資料庫角色腳本也還沒在正式庫實際執行。

## 資安現況

ExitPulse 是沒有帳號登入的公開唯讀服務。2026-11-24 完成一輪完整審查與 10 項弱掃，已落實 SQL 全參數化、入口輸入驗證、單一來源 IP 速率限制（僅在直連對端屬內網反向代理時採信 `X-Forwarded-For`）、API 非 root 容器並移除 Linux capability、嚴格 `script-src 'self'` CSP 與固定 commit SHA 的 GitHub Actions。

**尚未處理完的項目**（如實公開）：
- CSP 的 `style-src` 仍保留 `'unsafe-inline'`（本機 OWASP ZAP 列為 Medium，Angular 與 MapLibre 行內樣式所需的已知取捨，尚未改用 nonce）。
- 唯讀資料庫角色腳本（`deploy/create-readonly-role.sh`）尚未在正式資料庫實跑，API 容器亦尚未啟用唯讀檔案系統。
- 容器基底映像尚未固定 `@sha256`、`requirements.lock` 尚未加雜湊、`systemd` 加固與 Photon 查詢隱私說明待補。

完整縱深防禦清單、10 項弱點掃描明細與待改善項目請見 **[SECURITY.md](SECURITY.md)**，三項核心資安取捨與代價評估請見 **[docs/DECISIONS.md](docs/DECISIONS.md#2026-11-24-資安的三個取捨)**。

## 資料限制與授權

- **環狀線出站限制**：2017-01 至 2026-09 共 117 個月中，有 42 個月涉及環狀線 10 座單線車站目的站紀錄未完整涵蓋。API 回傳 `exitCovered: false`，介面明確標示「資料不足」並補上測試防漏，完整口徑、指標公式與 12 項外部資料授權見 **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)**。
- **程式碼授權**：本專案依 [MIT 授權](LICENSE)釋出。ExitPulse 為獨立開發的資料視覺化專案，與臺北大眾捷運股份有限公司無任何隸屬關係。
