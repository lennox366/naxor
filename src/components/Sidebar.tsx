import React, { useState } from 'react';
import { View, Chat } from '../types';
import { deleteChat, renameChat } from '../chatStore';
import { uiConfirm } from '../uiDialog';
import {
  LayoutDashboard, MessageSquarePlus, MessagesSquare, FolderKanban, Code2,
  Palette, Image as ImageIcon, Presentation, FileText, FolderOpen, Settings,
  ListChecks, X,
} from 'lucide-react';

interface Props {
  collapsed?: boolean;
  view: View;
  setView: (v: View) => void;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onChatsChanged: () => void;
}

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
  { id: 'chat', label: 'Neuer Chat', icon: <MessageSquarePlus /> },
  { id: 'projects', label: 'Projekte', icon: <FolderKanban /> },
  { id: 'codestudio', label: 'Coding Studio', icon: <Code2 /> },
  { id: 'designstudio', label: 'Design Studio', icon: <Palette /> },
  { id: 'imagegen', label: 'Bildgenerierung', icon: <ImageIcon /> },
  { id: 'presentations', label: 'Präsentationen', icon: <Presentation /> },
  { id: 'documents', label: 'Dokumente', icon: <FileText /> },
  { id: 'files', label: 'Dateiverwaltung', icon: <FolderOpen /> },
  { id: 'tasks', label: 'Aufgaben', icon: <ListChecks /> },
  { id: 'settings', label: 'Einstellungen', icon: <Settings /> },
];

export function Sidebar(p: Props) {
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const filtered = search
    ? p.chats.filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
    : p.chats;

  return (
    <aside className={`sidebar ${p.collapsed ? 'collapsed' : ''}`} aria-hidden={p.collapsed} {...(p.collapsed ? { inert: true } : {})}>
      <nav className="nav" style={{ paddingTop: 14 }}>
        {NAV.map(n => (
          <button
            key={n.id}
            className={`nav-item ${p.view === n.id ? 'active' : ''}`}
            onClick={() => {
              if (n.id === 'chat') p.onNewChat();
              else p.setView(n.id);
            }}
          >
            {n.icon} {n.label}
          </button>
        ))}
      </nav>
      <div className="chat-list">
        <div className="nav-section" style={{ paddingTop: 4 }}>Letzte Chats</div>
        <input
          type="text" placeholder="Chats filtern…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 8, padding: '8px 12px', fontSize: 12.5 }}
        />
        {filtered.slice(0, 30).map(c => (
          <div
            key={c.id}
            className={`chat-item ${p.activeChatId === c.id ? 'active' : ''}`}
            onClick={() => p.onSelectChat(c.id)}
            onDoubleClick={() => { setRenaming(c.id); setRenameVal(c.title); }}
            title="Doppelklick zum Umbenennen"
          >
            {renaming === c.id ? (
              <input
                autoFocus value={renameVal}
                onClick={e => e.stopPropagation()}
                onChange={e => setRenameVal(e.target.value)}
                onBlur={() => { if (renameVal.trim()) renameChat(c.id, renameVal.trim()); setRenaming(null); p.onChatsChanged(); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                style={{ flex: 1, fontSize: 12.5, padding: '4px 8px' }}
              />
            ) : (
              <>
                <MessagesSquare size={13} style={{ opacity: .55, flexShrink: 0 }} />
                <span className="t">{c.title}</span>
                <button
                  className="x" title="Löschen"
                  onClick={async e => { e.stopPropagation(); if (await uiConfirm(`Chat „${c.title}“ löschen?`)) { deleteChat(c.id); p.onChatsChanged(); } }}
                ><X size={12} /></button>
              </>
            )}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', padding: '8px 12px' }}>Keine Chats</div>}
      </div>
      <div className="footer">
        <span className="pulse-dot" />
        Lokal · SQLite · {p.chats.length} Chats
      </div>
    </aside>
  );
}
