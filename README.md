# ExitPulse｜臺北捷運旅次變化雷達

![Version 1.3.0](https://img.shields.io/badge/version-1.3.0-1d2125)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Angular 22](https://img.shields.io/badge/Angular-22-dd0031)
![FastAPI](https://img.shields.io/badge/FastAPI-Python_3-009688)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)

**打開地圖，看臺北捷運的人從哪裡來、往哪裡去。** 資料涵蓋 2017 年 1 月至 2026 年 9 月，共 117 個月。可以比較兩站的旅次變化、追蹤單一車站的逐時人流，或從路網圓面積一眼看出各站進站規模。

**[線上體驗](https://exitpulse.150-230-109-154.sslip.io)** · [三種檢視與操作](#三種檢視與操作方式) · [畫面預覽](#畫面預覽) · [本機開發](#快速開始) · [自行架設](#自行架設正式環境) · [系統架構](#系統架構與專案結構) · [分析與資料限制](#分析方法與資料限制) · [API 與效能](docs/API.md)

![實站 16:9 桌機淺色：2022-09 與 2026-09 平日早尖峰站對變化比較、可收合右上工具列與流向弧線](docs/images/live-pairs-16x9.png)

## 為什麼做 ExitPulse

單看各站進出人次，只知道哪一站人多。把旅次的起點和終點連回地圖上，才看得見哪兩站往來最密、哪條動線在不同月份與時段出現消長。從正式站切到「兩站比較」、「單站往來」或「全線人次」，可以直接試這三個例子：

- **南港 → 南港展覽館**：比較 `2022-09` 與 `2026-09` 平日早尖峰，日均從 `770.7` 增至 `1,594.4` 人次，站卡同時附上周邊設施與 6 公里現住人口作為站區背景參考。
- **國父紀念館**：切換週末或 24 小時「環形指紋」，查看各時段進站分布與自動標出的爆量日。
- **全線上班日**：選「純工作日」依行事曆排除國定假日並納入補班日，比較各站平均每日進站人次，不被連假天數稀釋。

## 三種檢視與操作方式

網站分為「兩站比較」、「單站往來」與「全線人次」三種模式。桌機版左邊看分析面板、右邊看地圖，展開面板開著明細時，畫面在 1100 px 以下也不會重疊。手機版在頂欄放置「地圖」、「分析」、「條件」與右側兩站／單站／全線選單，頂欄、工具列、底部摘要卡與時間軸等多數面板皆可摺疊以保留較大地圖視野，橫放時會提示轉回直立，也可以安裝到手機主畫面使用。

| 檢視模式 | 看什麼 | 能做什麼 |
| --- | --- | --- |
| **兩站比較** | 兩個期間之間，哪幾對車站的往來變化最大 | 依占比變化、人次增減或成長率排行，點排行表頭就能切換由大到小或由小到大，清單也能收合並顯示真實名次。可篩選日型、時段、路線、變化類型與最低人次，或點「手選兩站」查榜外組合、對調去回程、匯出 CSV 與 `1200×630` 結論圖卡 |
| **單站往來** | 這一站的人大多從哪來、往哪去 | 點六條捷運路線色塊從站碼清單選站，或直接輸入站名、站碼搜尋。「往來車站」清單可切換列表、資料表（點欄位標題排序）與路線分組，也能反轉排序或收合，並同時顯示占比與進出站人次。另附 24 小時環形指紋、逐時進出站、站型判讀與依據、距離分段、爆量日與歷年通車里程碑走勢 |
| **全線人次** | 整個路網的人潮集中在哪裡 | 支援「進站量」與「淨進出」雙視角。進站量用空心環面積標出各站規模（比較模式以外環為本期、實心內圓為對照期，內圓比外環大即減少），淨進出則以橘、藍雙色空心環對照淨流入（出站＞進站）與淨流出（進站＞出站），轉乘站選取時依各線分段上色，前 10 大站旁直接標出人次。分頁包含「各站」、「每天」、「歷年」、「互搭表」、「榜單」與「紀錄」，可看各站進出排行、參考比例圓圖例、熱門站對互搭矩陣、兩組站群或路線彙總比較，以及全網最忙與增減前 10 名榜單 |

### 地圖操作與輔助功能

- **地圖工具列、收藏與精選觀察**：右上角工具列可以收合，並新增「只看地圖」一鍵收起浮層（再按一次或按 `Esc` 還原）。桌機版包含找地點（用 Photon 查 OpenStreetMap 地名並算附近捷運站直線距離）、收藏（附「精選觀察」四組指標案例與「複製嵌入碼」）、定位、全圖、3D 立體尖塔與弧線（高度取平方根並附對照刻度）、深淺主題、「地圖工具」與「關於」，手機版則精簡為找地點、收藏、工具與收合（定位移進找地點，立體與深色模式移進工具面板）。地圖工具內可調整全線「圓圈淡化（0–80%）」、「減少動態效果」、個別開關道路／水系／捷運路網／比例尺／流向動畫與人流圖例，並可從主畫面安裝或全螢幕檢視地圖。
- **時間軸與日夜底圖**：時間軸固定在面板底部，拖到沒有紀錄的小時也不會跟著移位。長條兩側加了前一小時、後一小時按鈕與「早尖峰／午間／晚尖峰／夜間」四顆快跳鈕，拉桿有看得見的把手，播放、暫停、全天三顆按鈕換成同一套線條圖示，暫停後暫停鈕會反白。播放時會依日期估算臺北日出日落時間自動切換底圖明暗。
- **車站詳情與出口沿革**：點選任一車站可檢視站碼、首次通車日、中文維基百科站區簡介、6 公里生活圈現住人口、雙北 YouBike 2.0 站點、周邊商場／大學／醫院／客運轉運站與景點距離，以及出入口清單。展開出口可於地圖標出圖釘，查得官方公告者附上啟用與重開日期，其餘標示為「現況座標，年代待查」。指標旁附帶 `?` 說明浮窗，點擊即可查看定義。原始資料出處：[車站資料服務](https://data.taipei/dataset/detail?id=1eefa68d-7c8d-491b-8e75-66a161947426)、[出口座標](https://data.taipei/dataset/detail?id=cfa4778c-62c1-497b-b704-756231de348b)、[設施資訊](https://data.gov.tw/dataset/128453)、[觀光署景點](https://data.gov.tw/dataset/7777)。
- **資料判讀、空狀態與中文斷行**：結論句把期間獨立成上一行，假日只列名稱（例如「中秋節、教師節」），並一併列出人次、有效天數與實際有紀錄的時段（`recordedHours`），分開標示零人次、出站資料不足、尚未通車與查詢失敗。選到車站尚未通車的月份時，面板會顯示該站通車日期，並提供一鍵跳轉至最早有紀錄的月份。沒有旅次紀錄或查無車站時，改成置中的圖示加一句說明。全站中文只在標點或空白處換行，數字和單位不拆開，「台北101/世貿」這類站名也不會斷在斜線後。
- **網址同步、嵌入模式、快捷鍵與匯出**：網址列即時保存檢視模式、期間、篩選條件、排序、搜尋字串與選中站對，複製網址即可重現同一畫面，也可加上 `?embed=1`（或從收藏面板「複製嵌入碼」）以精簡視圖嵌入網頁。鍵盤可按 `/` 跳至搜尋框、`[` 收合左側面板、`J` 與 `K` 切換上下組站對、`Esc` 關閉細節或放大檢視。各表格皆可匯出 Excel 相容 CSV（UTF-8 BOM + CRLF），無基準期資料的成長率欄位留白不補 0。

<details>
<summary>實測範例：預設條件「南港 → 南港展覽館」（平日 07:00–10:00，兩期各 22 天，納入 104 站）</summary>

| 指標 | 2022-09 | 2026-09 |
| --- | --- | --- |
| 平均每日人次 | 770.7 | 1,594.4 |
| 原始人次 | 16,956 | 35,077 |
| 南港出發可比較旅次總數 | 118,278 | 171,077 |
| 占比變化 | | +6.17 百分點 |
| 方向指數（兩期皆正，屬單純成長） | 0.78 | 0.79 |

</details>

## 畫面預覽

| 實站 16:9：單站往來與站區開放資料 | 實站 16:9：全線各站進站規模 |
| --- | --- |
| ![單站往來：南港站「往來車站」排行、6 公里生活圈人口與 Wikidata／公運處周邊設施距離](docs/images/live-station-16x9.png) | ![全線人次：以圓面積呈現 119 站進站人次、圖例與可收合表頭排行](docs/images/live-network-16x9.png) |

![實站 16:9 深色 3D 立體模式：臺北盆地夜色底圖、立體弧線與可收合右上工具列](docs/images/live-3d-dark-16x9.png)

| 手機：站對清單 | 手機：站對詳情 |
| --- | --- |
| ![手機深色：頂欄分頁切換與站對排行清單](docs/images/mobile-list-dark.png) | ![手機深色：站對詳情與歷年走勢](docs/images/mobile-detail-dark.png) |

## 快速開始

本機開發需要 Docker（或自備 UTF-8 編碼的 PostgreSQL）、Python 3.13，以及符合 [Angular 22 版本需求](https://angular.dev/reference/versions)的 Node.js。

1. 啟動資料庫並匯入預設資料：

```bash
docker compose up -d --wait db
python -m pip install -r requirements.txt
python tools/setup.py
```

`tools/setup.py` 會從臺北市資料大平臺抓檔，預設匯入最近 12 個月並寫入車站資料與驗證結果，單月連同下載約 40 秒。要匯入 2017-01 起的完整資料請跑 `python tools/setup.py --all`，也可指定起訖月份（例如 `python tools/setup.py 2025-01 2026-09`）。已經匯入過的月份會自動跳過。

2. 設定連線字串並啟動 FastAPI：

```powershell
# PowerShell
$env:EXITPULSE_DATABASE_URL = 'postgresql://exitpulse:exitpulse@127.0.0.1:55432/exitpulse'
uvicorn main:app --app-dir apps/api --host 127.0.0.1 --port 5011
```

```bash
# bash
export EXITPULSE_DATABASE_URL='postgresql://exitpulse:exitpulse@127.0.0.1:55432/exitpulse'
uvicorn main:app --app-dir apps/api --host 127.0.0.1 --port 5011
```

互動式 API 文件位在 [http://127.0.0.1:5011/docs](http://127.0.0.1:5011/docs)。

3. 另開終端啟動前端，接著打開 [http://localhost:4200/](http://localhost:4200/)：

```bash
cd apps/web
npm ci
npx ng serve
```

前端開發伺服器會把 `/api` 代理到 `http://127.0.0.1:5011`。建議後端固定綁在 `127.0.0.1`，因為 Windows 上的 `localhost` 會先嘗試 IPv6，連不上時每次新連線會多等約 2 秒。

### 使用自備 PostgreSQL

先建好 UTF-8 資料庫，再設定 `EXITPULSE_DATABASE_URL`（或 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`）即可。`docker-compose.yml` 預設帳密只供本機測試，切勿將資料庫埠直接對外開放。若本機 55432 埠已被占用，可用 `EXITPULSE_DB_PORT=55433 docker compose up -d --wait db` 換埠並同步調整連線字串。

### 重建資料庫

```bash
docker compose down -v
docker compose up -d --wait db
python tools/setup.py --all
```

`down -v` 會清除資料庫卷冊，下載過的原始檔留在專案目錄的 `data/` 裡不會一起刪除。若只要單獨驗證已匯入月份可執行 `python tools/verify_od.py 2019-01 2026-09`，更新景點、出口與通車日等車站資訊則跑 `python tools/station_info.py --import`。

### 開發與測試

```bash
python -m unittest discover -s tests
npm --prefix apps/web test
npm --prefix apps/web run build
```

API 啟動後可跑連通測試與併發壓測：

```bash
python tools/smoke.py --web http://localhost:4200
python tools/stress_api.py --requests 200 --concurrency 20 --p95-ms 3000
```

需連資料庫的測試會讀取 `EXITPULSE_DATABASE_URL`（或 `PGDATABASE`），未設定時自動略過。另附 `tools/ux-scan.js` 可貼進瀏覽器開發者工具檢查過小觸控目標、文字遮擋與橫向捲動。正式站與本機的效能量測紀錄見 [API 與效能](docs/API.md)。

## 自行架設正式環境

在全新的 Linux 主機上只要安裝 Docker 與 Docker Compose，抓下程式庫執行 `./deploy/install.sh` 即可一鍵完成 `.env` 隨機密碼建立、Node 22 容器編譯前端、PostgreSQL 18 零前置自動建庫、公開資料與輔助資訊匯入，並自動安裝每月與每週更新的 `systemd` 定時排程（日後更新版本只需執行 `./deploy/update-all.sh upgrade`）。若需手動調整細節或從 `pg_dump` 備份還原，也可查閱完整手冊：

- **[從零自行架設與自動更新指南](deploy/README.md)**：包含一鍵安裝參數、`.env` 環境變數表、備份還原路線、Caddy HTTPS 反向代理與線上驗收。

## 系統架構與專案結構

```mermaid
flowchart LR
  subgraph src["資料來源"]
    A["臺北市資料大平臺<br/>OD 分時 CSV"]
    B["OpenStreetMap<br/>路線與車站"]
    C["政府公開資料與 Wikidata<br/>通車日、出口、景點、設施"]
  end
  subgraph etl["匯入（tools/）"]
    D["import_od_range.py<br/>import_od.py"]
    E["build_ref.py<br/>station_info.py"]
  end
  DB[("PostgreSQL 18<br/>每月一個 schema<br/>加上 exitpulse_ref")]
  subgraph api["FastAPI（apps/api）"]
    F["/api/v1/od/*<br/>快取與請求合併"]
    G["分析行程池<br/>query_od.py、analyze_od.py、leaders.py"]
  end
  H["Angular 22 與 MapLibre GL JS<br/>（apps/web）"]
  A --> D --> DB
  C --> E --> DB
  DB --> G --> F --> H
  B -. "靜態檔 public/metro" .-> H
  M["OpenFreeMap 3D 底圖<br/>Photon 地點搜尋"] -. 瀏覽器直接取用 .-> H
```

- **匯入**：每月資料通過日期、時段與矩陣完整度驗證後，於單一交易內寫入才開放查詢。跨月站名對照與行事曆存於 `exitpulse_ref`。
- **查詢**：API 透過常駐 Python 行程池執行分析（預設 2 個行程，各自持有 `od_postgres.ConnectionPool`），同鍵併發合併計算並以 gzip 回傳，排隊滿載回 `429`，逾時回 `504`。
- **前端**：地圖與面板共用查詢狀態並同步至網址列，重新整理或分享連結都能回到相同畫面。查詢失敗時會隔 5、10、20、40 秒自動重試，之後每 60 秒重試一次（分頁在背景時暫停，回到前景或恢復連線時立刻重試），App 回到前景或每 5 分鐘也會檢查是否有新版部署並自動清除快取重載。遇到 WebGL context 丟失或底圖暫時斷線時也會自動重建畫布並保留原查詢與視角。

```
apps/
  api/            FastAPI 應用（路由、分析行程池、地點搜尋）
  web/            Angular 22 前端（地圖、面板、時間軸、探索頁）
tools/
  setup.py        一鍵初始化（下載、匯入、車站資訊、驗證）
  import_od*.py   單月與區間 OD 匯入工具
  pack_trips.py   逐時旅次分組壓縮與無損切換工具
  query_od.py     單站、全網、矩陣、趨勢查詢模組
  analyze_od.py   站對比較與排行榜分析模組
  leaders.py      全網最忙與增減榜單模組
  station_info.py 車站通車日、出口、YouBike、人口與周邊設施匯入
  smoke.py        API 基本連通驗證
  stress_api.py   併發壓力測試
  ui-smoke.mjs    多視口版面與 Console 煙霧測試
tests/            Python 單元與資料庫合約測試
deploy/           正式部署設定（Dockerfile、Compose、Caddyfile、systemd 範本）
docs/             交接紀錄、架構決策、API 效能、自動更新與截圖
docker-compose.yml  本機 PostgreSQL 設定
```

## 分析方法與資料限制

### 指標定義

- **占比**：A → B 旅次數除以 A 出發的所有可比較旅次，變化量以百分點表示。
- **平均每日人次**：原始旅次數除以所選日型的有效天數。單站與全網查詢先將各起訖站對除以天數後加總，再四捨五入至小數點後一位，因此遇到恰好 `.05` 尾數時可能與原始整數總和直接相除相差 0.1。
- **方向指數**：`(AB−BA)/(AB+BA)`，其中 `AB` 為 A → B 旅次數，`BA` 為 B → A 旅次數。

### 可比較站點與主要方向反轉

- 只有兩個月份同時以起站與迄站出現的車站才納入比較。當兩站皆已營運但某方向當月無紀錄時才記為 0 人次，新通車車站不補 0，也不納入舊期比較。
- 板橋、大坪林、景安、頭前庄這四座轉乘站因不同年份的站名寫法不同，在確認合併規則前先排除於站對比較之外。
- 同時滿足四項條件才標示為**主要方向反轉**：兩期方向指數正負號相反、兩期方向指數絕對值皆至少 `0.10`、兩期方向指數差值至少 `0.25`、兩期雙向合計的每日人次均達所選門檻。

### 排名分數與日型篩選

```
|占比變化（百分點）| × sqrt(min(max daily, 500) / 100)
```

若符合主要方向反轉，分數再乘以 `1.25`。排行分數用來篩出變動顯著的候選組合，不等於統計學上的顯著性檢定。

- **平日**指週一至週五（含落在平日的國定假日），**純工作日**（`workday`）依政府行事曆排除國定假日並納入補班日，**週末**指週六與週日。兩站比較、單站往來、全線人次、互搭表、趨勢與榜單皆支援 `workday`。
- 可篩選基準月份、比較月份、日型、進站時段（07–10、10–16、16–19、19–24）、變化類型（全部、占比上升、占比下降、主要方向反轉）與每日最低人次（10、20、50、100）。

### 環狀線出站資料限制

已匯入的 `2017-01` 至 `2026-09`（共 117 個月）起訖旅次中，`2020-01` 及 `2023-05` 至 `2026-09` 共 42 個月有部分環狀線單線車站的目的站紀錄未完整涵蓋。受影響月份因站而異，涉及中原、中和、十四張、幸福、新北產業園區、新埔民生、景平、板新、橋和、秀朗橋共 10 站。

查到涵蓋不足的期間時，API 會回傳 `exitCovered: false`，介面出站欄與互搭表均顯示「資料不足」。只有完整涵蓋且實際無旅次時才顯示 `0`，進站人次則照常依已匯入紀錄顯示。

### 其他已知限制與系統邊界

- **閘門統計層級**：OD 資料與出入口座標分屬不同資料集，旅次統計僅到車站閘門層級，無法還原中途轉乘路線或單一出口進出人數。車站分段通車與出口異動日期的來源 URL 皆記錄於 `tools/station_info.py`。
- **周邊設施涵蓋範圍**：站卡周邊設施整合 Wikidata 與政府開放清冊，不保證完整收錄所有地標（例如台北 101 購物中心因 Wikidata 分類為摩天大樓而未列入商場清單），未收錄項目於介面會明確標示。
- **瀏覽器與前端載入**：地圖需支援 WebGL 2 的瀏覽器。前端已將 `maplibre-gl`（6.19.0）與 3D 繪圖拆為延遲載入，Initial bundle 約 `869 kB`（零預算警告）。
- **後端逾時與測試邊界**：查詢逾時回傳 `504` 後，背景分析行程仍會跑完該次查詢才釋放（單一 SQL 敘述則受 PostgreSQL `statement_timeout` 限制，排隊中的請求在用戶端提前斷線時會即時取消）。尚未執行真人受測的使用者測試。

### 待辦

- **機場捷運**：目前匯入的臺北捷運旅次只涵蓋板南、淡水信義、松山新店、中和新蘆、文湖、環狀六條線，沒有機場線。台北車站等轉乘站的色環因此只有六條線的顏色，機場線的進出站人次也沒有納入全線人次。機場捷運由桃園捷運營運，需先確認是否有公開的站間旅次資料，才能評估補上。
- **車站介紹更新**：站卡介紹是 `python tools/station_info.py --import` 匯入當下的維基摘要快照，不會自動更新，也還沒統計有幾站抓不到介紹。

## 資料來源、儲存與授權

旅次資料取自臺北市資料大平臺的「[臺北捷運每日分時各站 OD 流量統計](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d)」，欄位涵蓋日期、進站時段、進站、出站與人次，官方索引自 2017 年 1 月起算，實際可查範圍以 API 回報為準。

- PostgreSQL 存放月總量、分組壓縮後的每日逐時表（`trip_groups` 與相容檢視表 `trips`）及跨月參考資料。下載的原始 CSV 快取放在 `data/` 目錄並由 Git 忽略。
- 捷運路線與車站幾何由 `tools/fetch-metro-osm.mjs` 自 OpenStreetMap 抓取，存於 `apps/web/public/metro/`。底圖採用 OpenFreeMap 的 positron 向量樣式（含 3D 建築圖層）。
- `apps/web/public/od/default.json` 存放離線備援資料，就算後端未啟動，打開首頁也能直接操作預設比較範例。
- 系統規則與資料語意細節寫在 [CONTRIBUTING.md](CONTRIBUTING.md)，服務配置與交接細節見 [docs/HANDOFF.md](docs/HANDOFF.md)，排程自動更新見 [docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md)。

本專案程式碼依 [MIT 授權](LICENSE)釋出。下列外部資料與服務分別適用各自條款，散布或商用前請依原頁面規範為準：

| 項目 | 用途 | 授權或條款 |
| --- | --- | --- |
| [臺北捷運 OD 流量統計](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d) | 旅次資料 | 政府資料開放授權條款－第 1 版（依[同系列資料集](https://data.gov.tw/dataset/128506)標示，實際以資料集頁面為準） |
| OpenStreetMap | 捷運路線、車站與底圖資料 | © OpenStreetMap contributors，[ODbL](https://www.openstreetmap.org/copyright) |
| [OpenFreeMap](https://openfreemap.org/) | 向量圖磚與 positron 底圖樣式 | 見網站授權說明 |
| [Photon](https://photon.komoot.io/) | 地點搜尋 | 資料源自 OpenStreetMap，使用規範見網站說明 |
| [TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar) | 國定假日與補班日 | 見儲存庫授權 |
| 觀光署景點、出口座標、設施與雙北 YouBike 2.0 | 車站資訊與周邊導覽 | 依各資料集頁面標示為準 |
| [Wikidata](https://www.wikidata.org/) | 周邊商場、大學、鐵路與轉運站 | CC0 |
| 臺北市醫院清冊、新北市醫院清單、國土測繪中心、臺北市公運處 | 醫院與客運轉運站清單 | 依各資料集頁面標示為準（連結列於「關於」對話框） |
| 內政部戶政司開放資料 API | 各區現住人口與 6 公里生活圈人口 | 依原 API 頁面規範為準 |
| 中文維基百科 | 部分車站簡介摘要 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant)，於站卡附原文連結 |
| [Lucide](https://lucide.dev/) 圖示 | 介面圖示 | ISC，授權全文見 `apps/web/public/lucide-license.txt` |

ExitPulse 為獨立開發的資料視覺化專案，與臺北大眾捷運股份有限公司無任何隸屬關係。
