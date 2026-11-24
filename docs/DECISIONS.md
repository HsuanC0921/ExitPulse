# 決策紀錄

產品說明集中在 [README](../README.md)、[PRODUCT](../PRODUCT.md) 與 [DESIGN](../DESIGN.md)。早期 YouBike 規格保留作歷史紀錄。

## 2026-11-18 1.0.0 的視覺與匯出決定

- 版本號訂為 1.0.0，提交訊息採 Conventional Commits。這個專案還沒推送過，所以不經過 0.x 與 1.x。
- 選了站對或單站時，底圖上方蓋一層與陸地同色的半透明罩，把底圖退到背景。拖曳或縮放地圖時，浮在地圖上的面板淡出到 30%，放開後回來。兩者都是為了降低介面對地圖的遮擋，不是靠縮小面板。
- 深色主題的底圖原本只混入 28% 的夜色，看起來是灰色。改成預設接近全夜，單日時間軸的日夜變化在深色主題下只剩一小段範圍，淺色主題維持完整範圍。
- 底圖標籤改為繁體中文優先，沒有中文名稱才退回原文，避免每個地名都「拼音加中文」兩行。
- 立體建築使用 OpenFreeMap 的 building 圖層，近距離（約 15.3 級以上）才自動微傾 38 度，可在圖層選單關閉，設定存在瀏覽器本機。減少動態效果時不自動傾斜。
- CSV 匯出統一用 `csv-export.ts`：`#` 開頭的說明列（來源、口徑、期間、日型、時段、有效天數、查詢連結），空一行後才是資料表。數字欄保持純數字，字串欄開頭是公式字元時加單引號。站對 CSV 加上原始人次、起站總人次與方向指數，讓人可以自己重算占比。
- `days=workday` 只開放給單站、全網、矩陣、趨勢與榜單。它依行事曆排除國定假日並納入補班日。站對比較仍沿用 `weekday`（週一至週五，不扣假日），因為 README 與既有的黃金樣本都是這個定義，改了會讓兩邊對不上。
- 榜單的成長排名只列兩期都同時有進站與出站紀錄、對照期每日進站量至少 200 的站，並排除站名口徑未確認的轉乘站，與站對比較的可比較站點規則一致。
- 元件樣式預算由 24 kB 提高到 40 kB（警告 28 kB）。動效、圖層與手機版樣式都放在元件自己的 CSS，拆分的成本高於收益。前端主包仍超過 1.5 MB 的警告，尚未處理。

## 2026-11-18 車站脈絡和人流圖

- 車站首通車日期取正式通車資料，轉乘站取最早開始營運的線段。前端查詢範圍維持依最早旅次紀錄決定。站址使用官方車站資料，站區簡介使用北捷介紹與公告。觀光署景點按站點 700 公尺內的直線距離配對，每站最多三筆，只作周邊參考。
- 出入口位置來自現況快照。啟用、封閉和重開從官方公告補入。確知未開放的期間隱藏圖釘，史料不全的圖釘以外框與文字表示。月檢視涵蓋月中部分開放，確切日期請看出口事件。
- 中性灰階流帶和箭頭表達 OD 量及方向。單站增減改用正負數與虛實線，按增減幅度排前 10 名。人次標籤獨立成圖層，並嘗試不同位置，狹窄畫面仍有完整清單可查。縮放、傾斜期間，以固定螢幕寬度的線保持尺度，準備好新流帶才切回。箭頭在地圖移動時持續更新。
- 單日時間軸按同一日實際旅次數畫出 24 格，播放或拖曳時只切換選中小時。全網 API 用 `hourly=true` 要求附帶完整分布，既有查詢回應預設維持原格式。
- 專案約定集中在根目錄 `CONTRIBUTING.md`。README 提供人類也可直接使用的安裝、匯入及查詢步驟。

## 2026-11-18 PostgreSQL 與地圖查詢

- 正式讀寫改成 PostgreSQL。每個月份用獨立 schema 交易發佈，查詢只看已發佈的月份。月層包含原始逐時資料與查詢彙總，跨月資料另有自己的 schema。既有 SQLite 與原始 CSV 保留為資料來源和遷移對照。
- 全天月平均以該日型有紀錄的日期計算，特別營運的凌晨時段納入當天。自訂時段的各小時若涵蓋日期不同，就不比較。車站第一個可選日期以最早有旅次紀錄為準。
- 站對排行門檻仍控制榜單。手選站對可以查到未入榜的組合，方向反轉維持所選門檻。
- 站點設施與出入口採捷運公司開放資料。底圖與 POI 標註由 OpenFreeMap 提供，地點搜尋由 Photon 提供。最近站計算地點與站點間的直線距離。

## 2026-11-17 來源實測（開發機）（已停用）

| # | 規格假設 | 實測 | 處置 | 級別 |
| --- | --- | --- | --- | --- |
| 1 | 臺北總車格欄位 `quantity` | 實際為 `Quantity`（大寫） | Adapter 讀 `Quantity`，保留 `quantity` 後備 | A |
| 2 | 新北 `size=500` 可能被截短 | 500 筆／頁正常；`size=5000` 一頁回全量 1,622 | 維持逐頁讀到空頁＋頁數上限 40；不依賴單頁上限 | A |
| 3 | 新北有批次發布時間 | 無批次時間欄位，只有單站 `mday` | `sourcePublishedAtUtc` 對新北恆為 `null` | A |
| 4 | 捷運出口 CSV 為 UTF-8（BOM） | Big5／CP950 | Importer 以 CP950 解碼 | A |
| 5 | Node.js 24 | Angular CLI 22.2.7 engines 接受 `>=26.0.0`；本機 26.13.0 | 規格 §4 改為 24.15+ 或 26 | A |
| 6 | `.env` 用 `DATABASE_URL` | 連線字串用單一環境變數 `EXITPULSE_DATABASE_URL` | 改用標準鍵，省去 URL 轉換程式 | A |

## 同步與時間（已停用）

- 新北任一頁 HTTP／解析失敗、或某頁沒有新增任何站（分頁不前進）→ 整批作廢，`station_current` 不動，`sync_runs` 記一筆 `failed`。
- 空批次視為失敗，不覆寫上次完整狀態。
- 來源本地時間以固定格式解析並指定 UTC+08:00；格式不符 → `null`（未知），不猜格式。
- `dataQuality` 以單站來源時間對比 `now` 計算（Live）；沒有單站時間 → `unknown`。

## 2026-11-17 視覺與捷運路網（部分已停用）

- （已停用）視覺方向：印刷街道圖冊（紙色底、平塗油墨、雙線圖例框、A–O／1–13 索引格），捷運路線色與 YouBike 橘並用；細節見 `DESIGN.md`。
- （已停用）新增來源：交通部 TDX `Rail/Metro`（Line、Shape、Station；營運者 TRTC、NTMC、NTALRT、TYMC）。只用來畫路線與替出口上路線色，不建路網、不做轉乘推論。屬規格外的新增來源，級別 B。
- 取得方式：`tools/fetch-metro.ps1` 產生靜態 `apps/web/public/metro/{lines,stations}.geojson` 並納入版控；路網改線時手動重跑。未授權 TDX 每 IP 每日 20 次，可設 `TDX_CLIENT_ID`／`TDX_CLIENT_SECRET` 使用自己的金鑰。
- 檔案缺少時前端顯示「路線圖資尚未產生」，出口以墨色標示，不會假造路線。
- 底圖：OpenFreeMap positron 於前端載入後重新上色（`core/atlas.ts`），仍為免費圖磚並保留 OSM 署名。

## 2026-11-17 P2 任意點覆蓋（已停用）

- `GET /api/v1/coverage` 以 EF `SqlQuery` 參數化原生 SQL 查詢：`ST_DWithin(geom::geography, center, r)` 走既有 `geom::geography` GiST 索引，`ST_Distance` 回傳公尺；不依市界過濾，跨界照距離回兩市站點（實測 121.553,24.983 半徑 500m → 臺北 7、新北 2）。
- `SupplyState` 線上名稱依規格 §3.1 用 `below_threshold`、`no_station_in_source`（`JsonStringEnumMemberName`），不跟其他 enum 的 camelCase。
- 回應另加 `staleStationCount`、`suspendedStationCount`、每站 `district`／`longitude`／`latitude`／`totalDocks`，供面板列表與地圖重繪；判定（`rentState`／`returnState`、達標站數）只在後端算，前端只做顯示用的灰字標示。
- 介面只有一個門檻控制，同時送 `minRent`／`minReturn`（API 仍可分開）。理由：圖面門檻與覆蓋門檻分成兩組會讓展示時難以解釋；需要時再拆。
- 查詢圈為前端產生的地理圓（球面近似，顯示用）；距離判定一律以 PostGIS 結果為準。

## 2026-11-17 P3 歷史影格（已停用）

- `HistoryFrameWorker` 每分鐘檢查，UTC 取整到 10 分鐘為一格；該格已存在就跳過（重啟不重複）。在 RepeatableRead 交易內把 `station_current` 全量寫入 `history_frames`＋`station_samples`，同時記下各來源當下最新成功的 `sync_runs`。保留 7 天（`History:RetentionDays`），逾期整格刪除（樣本 cascade）。
- 影格的資料品質在**記錄當下**判定並存成文字（`fresh`／`stale`／`unknown`），回放時不以「現在」重算，否則所有舊影格都會變成過期。
- API：`/history/frames`（窗口 ≤ 8 天）、`/history/stations?frameId`、`/compare?frameA&frameB&mode`、`/coverage?frameId`、`/history/series`（定點半徑內每格可確定的站數與總量）。比較狀態：`comparable`／`added`／`removed`／`suspended`／`stale`／`unknown`，只有兩格都營運、新鮮、有值才算 delta（`CompareRules`）。
- 目前不做 bbox 篩選：全雙北一格約 3,447 筆，整格回傳仍在可接受大小；量大時再加。

## 2026-11-17 連續半徑與門檻（修訂規格 §7.1）（已停用）

- 規格原訂半徑 150/300/500、門檻 1/3/5/10 是固定選項；改為半徑 100–1000m（50m 一級）、門檻 1–20。理由：固定三段無法回答「最近的達標站在 430m」這類實際問題，且地圖上可直接拖拉圈邊把手。API 仍驗證範圍，越界回 400。
- 範圍內沒有達標站時，`/coverage` 另回 `nearestRent`／`nearestReturn`（最遠找到 1000m，即控制項可達範圍），前端提供「半徑改為 N m」一鍵擴大。

## 2026-11-17 視覺：三色孔版刊物（取代印刷街道圖冊）（已停用）

- 前一版圖冊風格被評為「太潔淨」、單純暈渲又與底圖不搭。改為 Riso 孔版：四種專色各印一種資料（藍＝地理、橘＝YouBike、粉＝查詢、黃＝捷運），深色用疊印色（multiply）而非另加黑。細節與對比數據見 `DESIGN.md`。
- 移除地形暈渲：AWS Terrarium 圖磚無 CORS 標頭，且風格不合；山區改以林地網點呈現（OSM landcover），不另取 DEM。
- 捷運路線全部印黃色，不分線色：四色限制是這個方向的核心；各線身分保留在出口面板的路線晶片（小色點＋線名）。

## 2026-11-17 捷運路網改用 OpenStreetMap

- 取代 TDX（未授權額度用完，且使用者要求暫停呼叫 TDX）。`tools/fetch-metro-osm.mjs` 經 Overpass 一次抓取 route=subway/light_rail/monorail，輸出既有格式的 `apps/web/public/metro/{lines,stations}.geojson` 並納入版控；不是執行期相依。授權 ODbL，地圖署名「© OpenStreetMap contributors」。
- OSM 線名含方向與別名、色碼不一致（如 `orange`），以腳本內固定對照表（10 條線）給正式名稱與線色；新北投支線併入淡水信義線；同名多節點的車站合併。
- 結果：10 條線、155 站、22 轉乘站；390 個出口全數對得到車站（含「台北車站」）。`tools/fetch-metro.ps1`（TDX）刪除。

## 2026-11-17 底圖改回彩色圖塊、捷運用官方路線色

- 孔版網點底圖辨識度差（使用者回饋），改為平塗圖塊（水、綠地、街廓、白色道路＋描邊）。
- 捷運不再統一印黃色，改用各線官方路線色，接近捷運路線圖。
- 移除供應 heatmap（光暈難看）；站點改為所有縮放都顯示、低縮放縮小並用細外框。
- 站點分級改為灰紫（未達）→ 橘（達標）→ 深咖啡（兩倍），單一橘色深淺難以分辨；深咖啡避開淡水信義線紅。
- 站點過密：縮放 ≤ 13 以 MapLibre cluster 合併，clusterProperties 加總每站預先計算的 ok／known 旗標（模式或門檻變更時重算），呈現「達標/站數」而非車數總和，避免把分散的車誤讀為一站可借。

## 2026-11-17 底圖改 liberty、GPS 定位與步行導航（已停用）

- positron 幾乎沒有 POI 與路名，無法邊看邊走。改用同為 OpenFreeMap 的 liberty，仍免費、保留 OSM 署名。
- 定位只在使用者按鈕時呼叫 `getCurrentPosition`，不在載入時要權限。
- 導航交給 Google 地圖步行路線（URL scheme，無 API 金鑰、無費用），本站不做路徑規劃。

## 2026-11-17 歷史回放與鐵路疊圖（已停用）

- 專案特色定為「時間」：後端每 10 分鐘的影格在前端做成時間軸回放與 24 小時曲線，缺漏處留空。
- 鐵路與捷運同做法：Overpass 一次抓成靜態檔，不依賴 TDX。沒有列車時刻資料，因此不畫移動列車。

## 2026-11-17 改為 OD 旅次變化雷達

- 產品方向由「捷運出口擁擠度與 YouBike 可借還」改為「捷運起訖（OD）人次的月份比較」。使用者要找的是哪些站之間的往來變化最大，這不需要即時資料，也用不到 YouBike。舊方向的決策已標為已停用。
- 移除 EF Core、資料庫、排程同步、歷史影格與 feeds。資料來源為 data.taipei 的捷運起訖人次資料集，已彙整成每月 sqlite 聚合檔放在 `data/od/`，不進版控。理由：比較兩個月份只需要靜態聚合，常駐同步與資料庫沒有對應的需求。
- 分析以 Python 標準函式庫讀取月度 sqlite，由 API（`apps/api/Program.cs`）以子行程執行 `tools/analyze_od.py`。不引入 pandas 等套件。
- 變化類型篩選（全部、比例上升、比例下降、方向反轉）在分析腳本內處理，前端只傳參數。
- 流動動畫使用 MapLibre 原生圖層（line、circle、symbol），不使用 deck.gl。理由：目前只需要弧線與點，原生圖層已足夠，免去一個大型依賴與它的版本耦合。
- 不做選用的 AI 說明文字。理由：結論句已由前端依數字產生，AI 說明會引入外部服務與金鑰管理，而現有數字已能直接解讀。
- 視覺方向採捷運指示系統語言，明亮為預設。理由：展示以投影為主，白底在投影上對比較穩定。深色保留為夜間版本，只換色票。詳見 `DESIGN.md`。
- 尚未確認站名對應的轉乘站不納入比較。理由：同一車站在不同來源可能被拆成多個站名或口徑，硬比會產生假變化。

## 2026-11-18 深色是同一張地圖「關燈」

- 明亮與深色共用 OpenFreeMap positron，不再換成獨立的 dark 樣式。理由：使用者要的是同一個房間裡看同一張動態地圖，只差有沒有開燈；換樣式會讓道路層級與標註位置改變。
- 深色只換色票（`DARK_MAP`）：陸地最暗，水面與綠地保留色相，道路略亮於陸地，資料圖層顏色不變。明亮色票不動。
- 先前「提亮近黑底圖」的做法已移除。
- 補匯入 2019 起缺的月份，使歷年比較可用；原始快取與月檔仍不進版控，刪除與否待 PostgreSQL 驗證後決定。

## 2026-11-18 API 改用 FastAPI

- 原本的 API 層只負責轉手，真正的工作都在 Python（匯入、分析、查詢）。改成單一語言後，不必維護跨行程的 worker 協定。
- 專案定位為以 Python 為主的作品集，所以 API 也用 Python。
- 以改前 API 的 27 組回應當黃金樣本比對，端點行為不變，前端不需修改。
- 已知取捨：行程池無法中止逾時的查詢，見 [API.md](API.md)。

## 2026-11-24 資安的三個取捨

API 是沒有登入的公開唯讀服務，所以這三個決定都在回答同一件事：一個匿名使用者最多能耗掉多少資源，以及我們怎麼知道他是誰。完整審查與掃描結果見 [README 資安一節](../README.md#資安)。

### 1. X-Forwarded-For 只信內網的反向代理

**問題。** 限速要以使用者 IP 為單位。API 前面有兩層 Caddy，API 看到的直連對端永遠是 Caddy 容器的內網位址。只看對端，全站使用者會共用一個桶子，一個人刷滿就全部被擋。直接採信 `X-Forwarded-For`，又會讓任何人在請求裡塞一個假位址，換一個 IP 就換一個新桶子，限速形同虛設。

**考慮過的選項。**
- 只用直連對端。簡單，但擋一個人等於擋所有人。
- 一律信 `X-Forwarded-For`。誰都能偽造。
- 只在直連對端是內網位址時才信，否則用對端本身。
- 在 API 加一份代理白名單設定。比上一項精確，但多一個要維護的設定。

**選擇與原因。** 採第三項。[limiter.py:19-33](../apps/api/limiter.py#L19) 的 `client_ip()` 在 `ipaddress.ip_address(peer).is_private` 為真時，才取 `X-Forwarded-For` 的第一個位址，格式不合就退回對端。外部連線直接打到 API 時對端是公網位址，帶什麼標頭都不採信。容器內 Caddy 在 [deploy/Caddyfile:2-6](../deploy/Caddyfile#L2) 設了 `trusted_proxies static private_ranges`，只信任來自內網的上一層標頭。API 容器沒有對外開埠，compose 只把網頁容器綁在 `127.0.0.1`（[deploy/docker-compose.prod.yml:89-90](../deploy/docker-compose.prod.yml#L89)），所以外部流量一定經過 Caddy。三個情境各有測試，見 [tests/test_security.py:43-47](../tests/test_security.py#L43)。

**代價與已知限制。**
- `is_private` 也包含內網其他主機。如果之後有別的內網服務能直接連到 API，它可以任意指定來源 IP。目前 API 不對外開埠，所以不成立，但若改變部署方式要重新檢查。
- 只取第一個位址。再多一層未列入信任範圍的代理時，取到的會是那一層以前的值，不一定是最終使用者。
- 這個判斷只靠網路拓樸，不是密碼學驗證。

### 2. 每個來源 IP 的速率限制

**問題。** 查詢有快取，但使用者只要換一個參數就能避開快取，讓分析行程池和排隊佇列滿載。原本只有全域的排隊上限，一個人就能把佇列塞滿，其他人收到 429。

**考慮過的選項。**
- 只留全域排隊上限。不分人，一人造成全體受害。
- 在 Caddy 做限速。需要額外外掛模組，而且和 API 的來源 IP 判斷分成兩套。
- 在 API 內做每個 IP 的 token bucket。
- 外接 Redis 之類的共用儲存。

**選擇與原因。** 採第三項。[limiter.py:36-53](../apps/api/limiter.py#L36) 的 `RateLimit` 是記憶體內的 token bucket，預設每分鐘補 240 次、瞬間可用 80 次（[limiter.py:14-15](../apps/api/limiter.py#L14)），可用 `EXITPULSE_RATE_PER_MINUTE` 與 `EXITPULSE_RATE_BURST` 調整，設 0 關閉。只管 `/api/` 路徑（[limiter.py:56](../apps/api/limiter.py#L56)），所以 `/health` 與 `/ready` 不受限，測試也驗證這點。超量回 429 並附 `Retry-After`（[limiter.py:68-69](../apps/api/limiter.py#L68)），同一個 IP 每 60 秒最多記一筆警告日誌（[limiter.py:65-67](../apps/api/limiter.py#L65)），避免被刷時日誌爆量。中介層在 [apps/api/main.py:77](../apps/api/main.py#L77) 掛上。目前沒有外部共用狀態的需求，所以不加 Redis。

**代價與已知限制。**
- 狀態只在單一行程的記憶體內。Dockerfile 的啟動指令是 `--workers 1`，所以現在正確。改成多個 worker 或多個容器，每個行程各算各的，實際上限會乘上行程數。
- 重啟後桶子歸零。
- 桶子最多記 10,000 個 IP，超過時清掉閒置超過 600 秒的項目（[limiter.py:16](../apps/api/limiter.py#L16)、[limiter.py:46-48](../apps/api/limiter.py#L46)）。大量不同來源的分散攻擊仍然擋不住，這需要在 Caddy 前面或上游處理。
- 240 次與 80 次是估計值，沒有用真實流量調過。
- 後端測試環境把限速設為 0（[tests/test_api.py:14](../tests/test_api.py#L14)），限速行為由 `test_security.py` 單獨驗證。

### 3. CSP 保留 `style-src 'unsafe-inline'`

**問題。** CSP 能擋掉注入的腳本，但前端的樣式有行內寫法。想收得最嚴，就要拿掉 `'unsafe-inline'`，可能弄壞版面。

**考慮過的選項。**
- 全面禁止行內樣式。最嚴，但要先改掉所有行內樣式來源。
- 改用 nonce 或 hash。要在每次回應產生 nonce，而前端是純靜態檔，由 Caddy 直接提供。
- 腳本嚴格，樣式放寬。

**選擇與原因。** 採第三項。[deploy/Caddyfile:17](../deploy/Caddyfile#L17) 的 `script-src 'self'` 不含 `'unsafe-inline'` 與 `'unsafe-eval'`，所以注入腳本無法執行，這是 CSP 最重要的保護。`style-src` 放寬到 `'self' 'unsafe-inline'`。圖片與連線只放行本站、`tiles.openfreemap.org` 與 `wmts.nlsc.gov.tw`，另有 `object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'none'`。HSTS 與 `X-Frame-Options` 不在這一層送，而是由主機 Caddy 送出，避免標頭重複（[deploy/Caddyfile:14-15](../deploy/Caddyfile#L14)、[deploy/README.md:139](../deploy/README.md#L139)）。用正式建置實際載入地圖，沒有任何 CSP 違規。

**代價與已知限制。**
- 攻擊者若能注入 HTML，仍可透過行內樣式改變外觀或做樣式式的資料外洩。腳本執行已被擋，所以風險比腳本低，但不是零。
- OWASP ZAP 對本機靜態站的掃描把這一項列為 Medium，我們接受它並寫在 README 待辦。
- 這份文件沒有逐一查證是哪些元件需要行內樣式，所以不能保證改用 nonce 一定可行，需要實測。
- Caddy 提供的是靜態檔，沒有伺服端產生 nonce 的地方。要改用 nonce 得先決定怎麼產生與注入。
