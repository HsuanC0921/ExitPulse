# ExitPulse UI 一致性與無障礙盤點報告（非 AI 程式化掃描）

產生時間：2026-11-18T19:31:30.353Z

掃描矩陣：pairs / station / network（手機含 map / analysis / conditions 分頁）× 1440 / 768 / 390 / 320 × light / dark

## 1. Token 階梯外離群值 Top 20

| # | 類別 | 值 | 出現次數 | 範例選擇器 |
|---|------|----|----------|------------|
| 1 | font-size | `10px` | 48 | `small` |
| 2 | border-radius | `2px` | 24 | `i` |
| 3 | gap | `6px` | 24 | `p.event-guard, ul, p.event-guard.event-note` |
| 4 | gap | `normal 6px` | 24 | `li` |

## 2. 屬性值分佈摘要

### border-radius
- `4px`：2876 次（`button, b.badge, div.distance-bar`）
- `8px`：878 次（`div.map-tools, summary, button.map-reset`）
- `50%`：856 次（`span.theme-track, span.rank, summary`）
- `12px`：40 次（`aside.panel, div.flowbar, section.time-player`）
- `2px`：24 次（`i`）
- `999px`：16 次（`b.personality-pill, b.personality-pill.role-pill`）

### font-size
- `12px`：4500 次（`span, span.tagline, i`）
- `16px`：1740 次（`span, h2, span.nm`）
- `18px`：360 次（`span.delta, span.delta.down`）
- `14px`：108 次（`span, span.sr-only, b`）
- `10px`：48 次（`small`）
- `20px`：44 次（`span.wordmark, span.pulse, strong.hour`）
- `26px`：36 次（`span.wordmark, span.pulse`）
- `32px`：24 次（`span.wordmark, span.pulse`）

### font-weight
- `700`：3236 次（`span, span.wordmark, span.tagline`）
- `800`：1972 次（`span.pulse, b, h2`）
- `400`：1652 次（`span, i, span.count`）

### button-height
- `44px`：516 次（`button.map-reset, button.map-reset.tower-switch, button.theme-switch`）
- `36px`：82 次（`button.icon-button.panel-wide-btn, button.icon-button, button.sort-reverse`）

### gap
- `4px`：1970 次（`summary, button.map-reset, button.map-reset.tower-switch`）
- `2px`：1452 次（`div.map-tools, div.sign-actions, span.codes`）
- `2px 8px`：1208 次（`span.names, small.row-meta, p.glance-title`）
- `8px`：1022 次（`app-brand, div.tools, button`）
- `12px`：60 次（`header.sign, div.ranking-head, div.list-head`）
- `0px 8px`：32 次（`button.section-toggle, span, h2.player-station`）
- `4px 12px`：32 次（`div.block-head.list-title, p.explore-legend`）
- `6px`：24 次（`p.event-guard, ul, p.event-guard.event-note`）
- `4px 8px`：24 次（`div.head-controls, div.playback`）
- `normal 6px`：24 次（`li`）

### horizontal-padding (top 15)
- `4px/4px`：1648 次（`button, b.badge, button.date-link`）
- `8px/8px`：922 次（`button.sort-reverse, button, button.station-info-link`）
- `10px/10px`：210 次（`button.map-reset, button.map-reset.tower-switch, button.theme-switch`）
- `6px/6px`：148 次（`button.icon-button.panel-wide-btn, button.icon-button, button.pause`）
- `12px/12px`：100 次（`button.section-toggle, button.more, button`）
- `2px/2px`：80 次（`button`）
- `10px/28px`：40 次（`select`）
- `32px/10px`：12 次（`input`）
- `8px/24px`：12 次（`select`）
- `16px/16px`：8 次（`button.primary`）

## 3. 同類元件規格一致性（height / radius / font-size）

### button（組合數：6 組）
- `h=44px r=8px fs=12px`：478 次（`button.map-reset, button.map-reset.tower-switch`）
- `h=36px r=8px fs=12px`：80 次（`button.icon-button.panel-wide-btn, button.icon-button`）
- `h=44px r=8px fs=14px`：22 次（`button.pause, button.sort-reverse`）
- `h=44px r=8px fs=16px`：8 次（`button.primary`）
- `h=44px r=0px fs=14px`：8 次（`button.flow-fold`）
- `h=36px r=8px fs=14px`：2 次（`button.sort-reverse`）

### rowCardButton（組合數：11 組）
- `h=85px r=0px fs=14px`：240 次（`button`）
- `h=70px r=0px fs=14px`：238 次（`button`）
- `h=95px r=0px fs=14px`：216 次（`button`）
- `h=69px r=0px fs=14px`：144 次（`button`）
- `h=56px r=0px fs=12px`：108 次（`button`）
- `h=44px r=0px fs=14px`：60 次（`button, button.pill`）
- `h=44px r=0px fs=12px`：12 次（`button.result-tools-toggle`）
- `h=44px r=8px fs=12px`：8 次（`button.peak-hour`）
- `h=73px r=0px fs=14px`：4 次（`button.section-toggle`）
- `h=36px r=0px fs=12px`：4 次（`button.result-tools-toggle`）

### chip（組合數：2 組）
- `h=44px r=4px fs=12px`：60 次（`button`）
- `h=36px r=4px fs=12px`：12 次（`button`）

### input（組合數：2 組）
- `h=44px r=8px fs=14px`：10 次（`input`）
- `h=36px r=8px fs=14px`：2 次（`input`）

### select（組合數：2 組）
- `h=44px r=8px fs=14px`：46 次（`select`）
- `h=36px r=8px fs=14px`：6 次（`select`）

### badge（組合數：1 組）
- `h=20px r=4px fs=12px`：1604 次（`b.badge`）

## 4. WCAG 文字對比不及格（0 項）


## 5. 粗指標／手機觸控目標 < 44px（0 項）


## 6. 同列元素 top 不齊（0 項）


## 6b. 意外直書／窄欄文字擠壓（0 項）


## 7. @axe-core/playwright 掃描違規（0 項）
