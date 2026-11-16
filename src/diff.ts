export interface DiffRow { type: 'same' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }

/** Simple LCS-based line diff (capped for performance). */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length, m = b.length;
  const MAX = 1200;
  if (n > MAX || m > MAX) {
    // fallback: everything changed
    return [
      ...a.map(t => ({ type: 'del' as const, text: t })),
      ...b.map(t => ({ type: 'add' as const, text: t })),
    ];
  }
  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0, j = 0, oldNo = 1, newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'same', text: a[i], oldNo: oldNo++, newNo: newNo++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: a[i], oldNo: oldNo++ }); i++; }
    else { rows.push({ type: 'add', text: b[j], newNo: newNo++ }); j++; }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++], oldNo: oldNo++ });
  while (j < m) rows.push({ type: 'add', text: b[j++], newNo: newNo++ });
  return rows;
}
