import React, { useEffect, useRef, useState } from 'react';
import { Search, Settings, Bell, Cpu, Minus, X, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import { Chat, AISettings, View } from '../types';
import { searchChats } from '../chatStore';
import { Logo } from './Logo';

interface Props {
  chats: Chat[];
  settings: AISettings;
  onOpenChat: (id: string) => void;
  onNavigate: (v: View) => void;
  onSettingsChange: (s: AISettings) => void;
  onMaximizeToggle: () => void;
  maximized: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar(p: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Chat[] | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setResults(null);
      if (!modelRef.current?.contains(e.target as Node)) setShowModels(false);
      if (!bellRef.current?.contains(e.target as Node)) setShowBell(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const onQuery = (v: string) => {
    setQ(v);
    setResults(v.trim().length >= 2 ? searchChats(v.trim()).slice(0, 6) : null);
  };

  const modelLabel = p.settings.provider === 'local'
    ? `Lokal · Auto-Router`
    : p.settings.provider === 'ollama'
    ? `Ollama · ${p.settings.ollamaModel}`
    : p.settings.provider === 'openai'
      ? `OpenAI · ${p.settings.openaiModel}`
      : `Custom · ${p.settings.customModel || '—'}`;

  const statusItems = [
    { label: 'Provider', value: p.settings.provider, ok: p.settings.provider === 'ollama' || !!(p.settings.openaiKey || p.settings.customUrl) },
    { label: 'Ollama erreichbar', value: p.settings.provider === 'ollama' ? 'geprüft beim Senden' : '—', ok: true },
    { label: 'Mikrofon', value: 'Berechtigung beim Aufnehmen', ok: true },
    { label: 'Chatverlauf', value: `${p.chats.length} gespeichert`, ok: true },
  ];

  return (
    <div className="topbar">
      <button
        className={`sb-toggle ${p.sidebarOpen ? 'open' : ''}`}
        onClick={p.onToggleSidebar}
        title={p.sidebarOpen ? 'Seitenleiste einklappen (Strg+B)' : 'Seitenleiste ausklappen (Strg+B)'}
        aria-label="Seitenleiste ein-/ausklappen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="4" />
          <rect className="pane" x="3.9" y="4.9" width="5.6" height="14.2" rx="3" fill="currentColor" stroke="none" />
          <path d="M9.5 4.5v15" />
        </svg>
      </button>
      <div className="brand-mini">
        <Logo size={30} className="mark" />
        <div>
          <div className="t1">NAXORA</div>
          <div className="t2">The Future of Intelligence</div>
        </div>
      </div>

      <div className="topnav-search" ref={searchRef}>
        <div className="box">
          <Search size={15} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Chats, Projekte oder Befehle suchen…"
            value={q}
            onChange={e => onQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && results?.length) { p.onOpenChat(results[0].id); setQ(''); setResults(null); }
              if (e.key === 'Escape') { setQ(''); setResults(null); (e.target as HTMLInputElement).blur(); }
            }}
          />
        </div>
        {results && (
          <div className="results">
            {results.length === 0 && <div className="ri" style={{ color: 'var(--ink-mute)' }}>Keine Treffer</div>}
            {results.map(c => (
              <div key={c.id} className="ri" onClick={() => { p.onOpenChat(c.id); setQ(''); setResults(null); }}>
                <Sparkles size={13} style={{ opacity: .6 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                <span className="when">{new Date(c.updated_at).toLocaleDateString('de-DE')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="topnav-right">
        <div ref={modelRef} style={{ position: 'relative' }}>
          <button className="model-chip" onClick={() => setShowModels(v => !v)}>
            <span className="dot" />
            <Cpu size={13} />
            <span style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelLabel}</span>
          </button>
          {showModels && (
            <div className="results" style={{ left: 'auto', right: 0, width: 240, top: 'calc(100% + 8px)' }}>
              {(['local', 'ollama', 'openai', 'custom'] as const).map(pr => (
                <div key={pr} className="ri" onClick={() => {
                  p.onSettingsChange({ ...p.settings, provider: pr });
                  setShowModels(false);
                  p.onNavigate('settings');
                }}>
                  <span>{pr === 'local' ? 'Lokal Universal (Auto)' : pr === 'ollama' ? 'Ollama (lokal)' : pr === 'openai' ? 'OpenAI' : 'Eigener Endpoint'}</span>
                  {p.settings.provider === pr && <span style={{ marginLeft: 'auto', color: 'var(--ink)' }}>●</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div ref={bellRef} style={{ position: 'relative' }}>
          <button className="top-icon-btn" title="Status" onClick={() => setShowBell(v => !v)}>
            <Bell size={17} />
            <span className="badge" />
          </button>
          {showBell && (
            <div className="results" style={{ left: 'auto', right: 0, width: 280, top: 'calc(100% + 8px)', padding: 6 }}>
              <div className="nav-section" style={{ padding: '8px 12px 4px' }}>Systemstatus</div>
              {statusItems.map(s => (
                <div key={s.label} className="ri" style={{ cursor: 'default' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.ok ? 'var(--ok)' : 'var(--warn)', flexShrink: 0 }} />
                  <span>{s.label}</span>
                  <span className="when">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="top-icon-btn" title="Einstellungen" onClick={() => p.onNavigate('settings')}>
          <Settings size={17} />
        </button>

        <div className="win-controls">
          <button onClick={() => (window as any).studio.win.minimize()}><Minus size={14} /></button>
          <button onClick={p.onMaximizeToggle}>{p.maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
          <button className="close" onClick={() => (window as any).studio.win.close()}><X size={15} /></button>
        </div>
      </div>
    </div>
  );
}
