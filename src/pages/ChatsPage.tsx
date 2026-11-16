import React, { useState } from 'react';
import { Chat } from '../types';
import { searchChats, deleteChat } from '../chatStore';
import { uiConfirm } from '../uiDialog';

interface Props {
  onOpen: (id: string) => void;
  onChanged: () => void;
  refreshKey: number;
}

export function ChatsPage({ onOpen, onChanged, refreshKey }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Chat[] | null>(null);

  React.useEffect(() => { setResults(null); }, [refreshKey]);

  const doSearch = () => setResults(q.trim() ? searchChats(q.trim()) : null);

  const list = results ?? [];
  const all = results === null ? null : list;

  return (
    <div className="view narrow">
      <div className="page-title">Chatverlauf</div>
      <div className="page-sub">Alle Unterhaltungen durchsuchen, öffnen oder löschen.</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input type="text" style={{ flex: 1 }} placeholder="Titel oder Nachrichteninhalt suchen…" value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} />
        <button className="btn primary" onClick={doSearch}>Suchen</button>
        {results && <button className="btn" onClick={() => { setQ(''); setResults(null); }}>Reset</button>}
      </div>
      {results === null ? (
        <div className="empty-state">Führe eine Suche aus oder öffne einen Chat über die Sidebar.</div>
      ) : all!.length === 0 ? (
        <div className="empty-state">Keine Ergebnisse.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {all!.map(c => (
            <div key={c.id} className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>{new Date(c.updated_at).toLocaleString('de-DE')}</div>
              </div>
              <button className="btn" onClick={() => onOpen(c.id)}>Öffnen</button>
              <button className="btn danger" onClick={async () => { if (await uiConfirm('Chat löschen?')) { deleteChat(c.id); setResults(searchChats(q)); onChanged(); } }}>Löschen</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
