// 收藏：只存在這台瀏覽器，靠匯出檔或收藏連結搬到別台，不需要帳號。
export type CollectionKind = 'pair' | 'station' | 'network';
export type CollectionItem = { id: string; kind: CollectionKind; name: string; query: string; savedAt: string };
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const COLLECTION_KEY = 'exitpulse.collection.v1';
export const COLLECTION_LIMIT = 24;
export const LINK_PREFIX = '#collection=';
const OLD_VIEWS = 'exitpulse.saved.v1', OLD_PAIRS = 'exitpulse.favPairs.v1';
const KINDS: readonly string[] = ['pair', 'station', 'network'];
// 只接受本站的查詢字串，外站網址或其他路徑一律不收
const QUERY = /^\?[^#\s]{0,600}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const today = () => new Date().toISOString().slice(0, 10);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const keyOf = (item: Pick<CollectionItem, 'kind' | 'query'>) => `${item.kind}|${item.query}`;

/** 驗證單筆收藏，不合格回 null。名稱過長截斷，id 缺漏補新的。 */
export function cleanItem(raw: unknown): CollectionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const kind = v['kind'] ?? v['mode'];
  const query = v['query'];
  if (typeof kind !== 'string' || !KINDS.includes(kind) || typeof query !== 'string' || !QUERY.test(query)) return null;
  const name = typeof v['name'] === 'string' ? v['name'].replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  const id = typeof v['id'] === 'string' && /^[\w-]{1,64}$/.test(v['id']) ? v['id'] : newId();
  const savedAt = typeof v['savedAt'] === 'string' && DAY.test(v['savedAt']) ? v['savedAt'] : '';
  return { id, kind: kind as CollectionKind, name: name || '未命名收藏', query, savedAt };
}

/** 把 incoming 併進 current：同種類同查詢只留一筆，新的排前面，超過上限丟掉最舊的。 */
export function mergeItems(current: CollectionItem[], incoming: CollectionItem[]) {
  const seen = new Set(current.map(keyOf)), ids = new Set(current.map(i => i.id)), added: CollectionItem[] = [];
  for (const item of incoming) {
    if (seen.has(keyOf(item))) continue;
    seen.add(keyOf(item));
    added.push(ids.has(item.id) ? { ...item, id: newId() } : item);
    ids.add(added[added.length - 1].id);
  }
  const all = [...added, ...current];
  return { items: all.slice(0, COLLECTION_LIMIT), added: added.length, dropped: Math.max(0, all.length - COLLECTION_LIMIT) };
}

function parseList(value: unknown): CollectionItem[] {
  return Array.isArray(value) ? value.map(cleanItem).filter((i): i is CollectionItem => i !== null) : [];
}

/** 讀存檔：新版 {app, version, items} 或舊版探索收藏的陣列。格式不對時丟出可直接顯示的訊息。 */
export function parseExport(text: string): CollectionItem[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('這不是這裡匯出的檔案'); }
  const list = Array.isArray(data) ? data
    : data && typeof data === 'object' && (data as Record<string, unknown>)['app'] === 'ExitPulse' ? (data as Record<string, unknown>)['items'] : null;
  if (!Array.isArray(list)) throw new Error('這不是這裡匯出的檔案');
  const items = parseList(list);
  if (!items.length) throw new Error('這個檔案裡沒有收藏');
  return items;
}

export function serializeExport(items: CollectionItem[]): string {
  return JSON.stringify({ app: 'ExitPulse', version: 1, exportedAt: today(), items }, null, 2);
}

/** 收藏連結：整份收藏放在 # 後面，不會送到伺服器。 */
export function encodeLink(items: CollectionItem[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(items.map(i => [i.kind, i.name, i.query, i.savedAt])));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return LINK_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLink(hash: string): CollectionItem[] {
  if (!hash.startsWith(LINK_PREFIX)) return [];
  try {
    const binary = atob(hash.slice(LINK_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
    const rows: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
    if (!Array.isArray(rows)) return [];
    return parseList(rows.map(r => Array.isArray(r) ? { kind: r[0], name: r[1], query: r[2], savedAt: r[3] } : null));
  } catch { return []; }
}

function readJson(storage: StorageLike, key: string): unknown {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** 讀取收藏。第一次使用時把舊的探索收藏與站對星號搬進來，舊資料不刪。 */
export function loadCollection(storage: StorageLike): CollectionItem[] {
  const saved = readJson(storage, COLLECTION_KEY);
  if (Array.isArray(saved)) return parseList(saved).slice(0, COLLECTION_LIMIT);
  const pairs = readJson(storage, OLD_PAIRS);
  const oldPairs = Array.isArray(pairs) ? pairs.flatMap(p => {
    const o = p?.origin, d = p?.destination;
    return typeof o === 'string' && typeof d === 'string' && o && d && o !== d
      ? [{ kind: 'pair', name: `${o} → ${d}`, query: '?' + new URLSearchParams({ p: `${o}>${d}` }) }] : [];
  }) : [];
  return mergeItems([], parseList([...(Array.isArray(readJson(storage, OLD_VIEWS)) ? readJson(storage, OLD_VIEWS) as unknown[] : []), ...oldPairs])).items;
}

/** 寫入失敗（無痕模式、空間滿）回 false，呼叫端要提醒使用者先匯出。 */
export function saveCollection(storage: StorageLike, items: CollectionItem[]): boolean {
  try { storage.setItem(COLLECTION_KEY, JSON.stringify(items)); return true; } catch { return false; }
}

export function newItem(kind: CollectionKind, name: string, query: string): CollectionItem | null {
  return cleanItem({ kind, name, query, savedAt: today() });
}
