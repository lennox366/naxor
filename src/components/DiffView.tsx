import React from 'react';
import { diffLines, DiffRow } from '../diff';

export function DiffView({ oldText, newText, filePath }: { oldText: string; newText: string; filePath?: string }) {
  const rows = diffLines(oldText, newText);
  const adds = rows.filter(r => r.type === 'add').length;
  const dels = rows.filter(r => r.type === 'del').length;

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--glass-edge-soft)', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.55 }}>
      <div style={{ display: 'flex', gap: 12, padding: '8px 14px', background: 'rgba(255,255,255,.05)', borderBottom: '1px solid var(--glass-edge-soft)', fontSize: 11.5, color: 'var(--ink-dim)' }}>
        {filePath && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{filePath}</span>}
        <span style={{ color: 'var(--ok)' }}>+{adds}</span>
        <span style={{ color: 'var(--danger)' }}>−{dels}</span>
      </div>
      <div style={{ maxHeight: 480, overflow: 'auto', background: 'rgba(5,6,8,.6)' }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', whiteSpace: 'pre',
            background: r.type === 'add' ? 'rgba(87,171,90,.10)' : r.type === 'del' ? 'rgba(229,83,75,.10)' : 'transparent',
          }}>
            <span style={{ width: 44, textAlign: 'right', padding: '0 8px', color: 'var(--ink-mute)', userSelect: 'none', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.05)' }}>
              {r.oldNo ?? ''}
            </span>
            <span style={{ width: 44, textAlign: 'right', padding: '0 8px', color: 'var(--ink-mute)', userSelect: 'none', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.08)' }}>
              {r.newNo ?? ''}
            </span>
            <span style={{ padding: '0 12px', color: r.type === 'add' ? '#9fdcab' : r.type === 'del' ? '#f0b1ad' : 'var(--ink-dim)', flex: 1 }}>
              {r.type === 'add' ? '+ ' : r.type === 'del' ? '− ' : '  '}{r.text || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
