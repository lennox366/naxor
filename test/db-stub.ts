// Minimaler In-Memory-Stub für die knowledge-Tabelle (nur für Tests).
const rows: any[] = [];
export function query<T = any>(sql: string, params: any[] = []): T[] {
  if (/FROM knowledge/i.test(sql)) {
    const scope = params[0];
    const hasKind = /kind=\?/.test(sql);
    const kind = hasKind ? params[1] : null;
    const qIdx = hasKind ? 2 : 1;
    const q = (params[qIdx] || '').toLowerCase().replace(/%/g, '');
    const wantsGlobal = /scope='global'/.test(sql);
    return rows
      .filter(r => (r.scope === scope || (wantsGlobal && r.scope === 'global')) && (!kind || r.kind === kind))
      .filter(r => !q || (r.title + ' ' + r.content).toLowerCase().includes(q))
      .sort((a, b) => (b.verified || 0) - (a.verified || 0))
      .slice(0, 10) as T[];
  }
  return [] as T[];
}
export function run(sql: string, params: any[] = []) {
  if (/INSERT INTO knowledge/i.test(sql)) {
    // (id, scope, kind, title, content, verified, created_at)
    rows.push({ id: params[0], scope: params[1], kind: params[2], title: params[3], content: params[4], verified: params[5] || 0, created_at: params[6] });
  }
}
export function _rows() { return rows; }
export async function initDB() {}
