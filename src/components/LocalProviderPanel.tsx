import React, { useEffect, useState } from 'react';
import { AISettings } from '../types';
import { LocalModel, scanLocalModels, ModelRole } from '../llm';
import { HardDrive, RefreshCw, Bot, Code2, Eye, Palette } from 'lucide-react';

interface Props {
  s: AISettings;
  setS: (fn: (prev: AISettings) => AISettings) => void;
  onChange: (s: AISettings) => void;
}

const ROLES: { key: ModelRole; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: 'chat', label: 'Chat / Allgemein', icon: <Bot size={13} />, hint: 'Normale Unterhaltungen' },
  { key: 'code', label: 'Coding-Agent', icon: <Code2 size={13} />, hint: 'Dateien, Terminal, Agent' },
  { key: 'vision', label: 'Bildanalyse', icon: <Eye size={13} />, hint: 'Bilder verstehen' },
  { key: 'design', label: 'Design', icon: <Palette size={13} />, hint: 'UI/UX-Aufgaben' },
];

export function LocalProviderPanel({ s, setS, onChange }: Props) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const refresh = async () => {
    setLoading(true); setErr('');
    try {
      const list = await scanLocalModels();
      setModels(list);
      if (list.length === 0) setErr('Keine GGUF-Modelle gefunden. Bitte Modelle über Ollama pullen (z. B. ollama pull qwen2.5-coder:3b).');
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const setRole = (role: ModelRole, name: string) => {
    setS(prev => {
      const next = { ...prev, roleModels: { ...(prev.roleModels || {}), [role]: name || undefined } };
      import('../services/ai').then(m => m.saveSettings(next));
      onChange(next);
      return next;
    });
  };

  const fmt = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`;

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div className="glass-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <h3 style={{ flex: 1 }}>Lokale GGUF-Modelle (kostenlos, CPU-fähig)</h3>
          <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={refresh} disabled={loading}>
            <RefreshCw size={13} /> {loading ? 'Scanne…' : 'Neu scannen'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14, lineHeight: 1.7 }}>
          Die App startet automatisch <code>llama-server</code> (CPU-only) mit dem passenden Modell — je nach Aufgabe.
          Modelnamen in Ollama-Pull-Form (<code>name:tag</code>). Rollen werden automatisch aus dem Namen erkannt, du kannst sie hier überschreiben.
        </div>

        {models.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 220, overflowY: 'auto' }}>
            {models.map(m => (
              <div key={m.path} className="glass-chip" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', fontSize: 12.5 }}>
                <HardDrive size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>{fmt(m.size)}</span>
                <span style={{ color: 'var(--ink-mute)', fontSize: 10.5 }}>{m.roles.join(' · ')}</span>
              </div>
            ))}
          </div>
        )}

        {err && <div style={{ fontSize: 12.5, color: 'var(--warn)', marginBottom: 12 }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          <label className="field">mmproj-Pfad für Bildanalyse (optional, GGUF-Datei)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1 }}
              placeholder="z. B. C:\Models\mmproj-Qwen2.5-VL-3B.f16.gguf"
              value={s.mmprojPath || ''}
              onChange={e => { const v = e.target.value; setS(prev => ({ ...prev, mmprojPath: v })); onChange({ ...s, mmprojPath: v }); }}
            />
            <button className="btn" style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
              onClick={async () => {
                try {
                  const files = await (window as any).studio.fs.pickFiles({ filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
                  const p = files?.[0];
                  if (p) { setS(prev => ({ ...prev, mmprojPath: p })); onChange({ ...s, mmprojPath: p }); }
                } catch { /* picker optional */ }
              }}>Durchsuchen</button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>
            Vision-Modelle (qwen2.5vl etc.) brauchen eine separate mmproj-Datei, damit llama-server Bilder verstehen kann.
            Ohne diese Datei ist die Bildanalyse deaktiviert.
          </div>
        </div>

        <div className="grid-2">
          {ROLES.map(r => (
            <div key={r.key}>
              <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{r.icon} {r.label}</label>
              <select
                style={{ width: '100%' }}
                value={(s.roleModels as any)?.[r.key] || ''}
                onChange={e => setRole(r.key, e.target.value)}
              >
                <option value="">Auto (größtes fähiges Modell)</option>
                {models.map(m => (
                  <option key={m.name} value={m.name} disabled={!m.roles.includes(r.key)}>
                    {m.name}{m.roles.includes(r.key) ? '' : ' (nicht fähig)'}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>{r.hint}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
