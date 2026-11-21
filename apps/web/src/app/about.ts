// 「關於與授權」：資料來源、地圖出處、免責聲明與軟體授權，全站只有這一個入口。
import { ChangeDetectionStrategy, Component, ElementRef, viewChild } from '@angular/core';

@Component({
  selector: 'app-about',
  template: `
    <dialog #dialog aria-labelledby="about-title" (click)="backdrop($event)">
      <header>
        <h2 id="about-title">關於 ExitPulse <small class="ver">v1.4.1</small></h2>
        <button type="button" class="close" aria-label="關閉" (click)="close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>
      <div class="body">
        <p class="lead">捷運旅次變化雷達，用來比較兩個月份之間，各站往來人流的增減。這是個人作品，不是臺北捷運公司或臺北市政府的官方服務，彼此沒有隸屬關係。</p>

        <section>
          <h3>數字代表什麼</h3>
          <ul>
            <li>統計的是閘門的進站與出站人次，不是完整行程，也看不出轉乘走了哪一條路線。</li>
            <li>地圖上的弧線是起訖兩站之間的示意，不是實際行車路線。</li>
            <li>資料是事後的月統計，不是即時資訊，也不保證完整。請勿作為營運、投資或法律判斷的唯一依據。</li>
          </ul>
        </section>

        <section>
          <h3>資料來源</h3>
          <ul>
            <li><a href="https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d" target="_blank" rel="noopener">臺北捷運每日分時各站 OD 流量統計資料</a>，臺北市資料大平臺，適用政府資料開放授權條款第 1 版，實際以資料集頁面標示為準。</li>
            <li>捷運路線與車站座標來自 OpenStreetMap。</li>
            <li>國定假日與補班日來自 <a href="https://github.com/ruyut/TaiwanCalendar" target="_blank" rel="noopener">TaiwanCalendar</a>。</li>
            <li>景點、出口與設施資訊來自觀光署、臺北市資料大平臺，周邊公共自行車來自雙北交通局 YouBike 2.0 公開資料（依各站實際收錄顯示），授權依各資料集頁面。</li>
            <li>周邊商場、大學、鐵路與轉運站來自 <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata（CC0）</a>，依各站實際收錄顯示。設施清單依公開資料整理，不保證完整，部分地點可能缺漏。</li>
            <li>醫院來源包括 <a href="https://data.gov.tw/dataset/121182" target="_blank" rel="noopener">臺北市醫院清冊</a>、<a href="https://data.ntpc.gov.tw/datasets/85bfcaa8-9932-4d06-a2ec-731171191883" target="_blank" rel="noopener">新北市醫院地址清單</a>和<a href="https://data.gov.tw/dataset/139250" target="_blank" rel="noopener">國土測繪中心設施座標</a>。</li>
            <li>臺北市客運轉運站優先採用<a href="https://data.taipei/dataset/detail?id=78d3bc44-f897-49b6-8294-a1bf3966f648" target="_blank" rel="noopener">臺北市公運處轉運站資料</a>。</li>
            <li>各行政區現住人口統計來自內政部戶政司開放資料 API（依各站實際收錄顯示）。</li>
            <li>車站歷史沿革未有官方條目時，若有收錄中文維基百科摘要，依 <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant" target="_blank" rel="noopener">CC BY-SA 4.0</a> 授權並於卡片附上原文連結。</li>
          </ul>
        </section>

        <section>
          <h3>地圖與圖資</h3>
          <ul>
            <li>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>，依 ODbL 授權。</li>
            <li>向量底圖與樣式由 <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> 提供，© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>；臺灣通用電子地圖（WMTS）來自<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>。</li>
            <li>地點搜尋使用 <a href="https://photon.komoot.io/" target="_blank" rel="noopener">Photon</a>。</li>
            <li>地圖引擎為 MapLibre GL JS，圖示為 <a href="https://lucide.dev/" target="_blank" rel="noopener">Lucide</a>。</li>
            <li>圖磚與地點搜尋由這些第三方服務直接提供，你的瀏覽器會向它們發出請求。</li>
          </ul>
        </section>

        <section>
          <h3>本專案</h3>
          <p>程式碼依 MIT 授權釋出。上列外部資料與服務各自適用自己的條款，散布或商用前請以原頁面規範為準。</p>
        </section>
      </div>
    </dialog>
  `,
  styleUrl: './about.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class About {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open() { const el = this.dialog().nativeElement; if (!el.open) el.showModal(); }
  close() { this.dialog().nativeElement.close(); }
  /** 點到對話框以外的遮罩就關閉 */
  backdrop(event: MouseEvent) { if (event.target === this.dialog().nativeElement) this.close(); }
}
