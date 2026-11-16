import React, { useEffect, useState } from 'react';
import { Folder, FileText, ArrowLeft } from 'lucide-react';
import { uiAlert } from '../uiDialog';

interface Node { name: string; path: string; isDir: boolean }

export function FileManager({ initialPath }: { initialPath?: string }) {
  const [cwd, setCwd] = useState(initialPath || '');
  const [entries, setEntries] = useState<Node[]>([]);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { if (initialPath) setCwd(initialPath); }, [initialPath]);

  const refresh = async (dir?: string) => {
    const d = dir ?? cwd;
    if (!d) {
      const p = await (window as any).studio.fs.pickFolder();
      if (p) setCwd(p); else return;
      return;
    }
    try {
      const list = await (window as any).studio.fs.readDir(d);
      setEntries(list.sort((a: Node, b: Node) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      setError('');
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => { refresh(cwd); }, [cwd]);

  const open = async (n: Node) => {
    if (n.isDir) { setCwd(n.path); setPreview(null); return; }
    try {
      const c = await (window as any).studio.fs.readFile(n.path, 500_000);
      setPreview({ path: n.path, content: c });
    } catch (e: any) { uiAlert(e.message); }
  };

  const parent = cwd.replace(/[\\/][^\\/]+$/, '') || cwd;

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="page-title">Dateiverwaltung</div>
          <div className="page-sub">Lokale Ordner durchsuchen und Dateien ansehen.</div>
        </div>
        <button className="btn" onClick={async () => { const p = await (window as any).studio.fs.pickFolder(); if (p) setCwd(p); }}>Ordner wählen</button>
        <button className="btn" onClick={() => refresh()} disabled={!cwd}>Aktualisieren</button>
      </div>
      {cwd && <div className="fm-path">{cwd}</div>}
      {error && <div className="toast err" style={{ position: 'static', transform: 'none', alignSelf: 'flex-start' }}>{error}</div>}
      <div className="fm" style={{ flex: 1, minHeight: 0 }}>
        <div className="glass-card fm-tree">
          {cwd && (
            <div className="fi" onClick={() => setCwd(parent)}>
              <span style={{ display: 'flex' }}><ArrowLeft size={14} /></span><span>.. (übergeordnet)</span>
            </div>
          )}
          {entries.map(n => (
            <div key={n.path} className={`fi ${preview?.path === n.path ? 'sel' : ''}`} onClick={() => open(n)}>
              <span style={{ color: n.isDir ? 'var(--ink-dim)' : 'var(--ink-mute)', display: 'flex' }}>{n.isDir ? <Folder size={14} /> : <FileText size={14} />}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
            </div>
          ))}
          {entries.length === 0 && cwd && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-mute)' }}>Leerer Ordner</div>}
          {!cwd && <div className="empty-state" style={{ padding: 30 }}>Wähle einen Ordner, um zu beginnen.</div>}
        </div>
        <div className="glass-card fm-main">
          {preview ? (
            <>
              <div className="fm-path">{preview.path}</div>
              <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-dim)' }}>{preview.content.slice(0, 200000)}</pre>
            </>
          ) : (
            <div className="empty-state">Datei zum Ansehen auswählen.</div>
          )}
        </div>
      </div>
    </div>
  );
}
