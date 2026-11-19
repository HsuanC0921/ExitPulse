export function readFold(key: string, fallback = false): boolean {
  try {
    const stored = localStorage.getItem('exitpulse.' + key);
    return stored == null ? fallback : stored === 'closed';
  } catch {
    return fallback;
  }
}

export function writeFold(key: string, folded: boolean): void {
  try { localStorage.setItem('exitpulse.' + key, folded ? 'closed' : 'open'); }
  catch { /* The current view still remembers the choice. */ }
}
