import React, { useCallback, useEffect, useState } from 'react';
import { AISettings } from '../types';
import {
  checkOllama, listOllamaModels, pullOllamaModel, deleteOllamaModel, testOllamaModel,
  OllamaModelInfo, CODING_MODEL_SUGGESTIONS, CHAT_MODEL_SUGGESTIONS,
} from '../services/ai';
import { CheckCircle2, XCircle, Download, Trash2, RefreshCw, HardDrive, Sparkles, Zap } from 'lucide-react';
import { uiConfirm } from '../uiDialog';

interface Props {
  settings: AISettings;
  onChange: (s: AISettings) => void;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
}

export function ModelManager({ settings, onChange }: Props) {
  const [status, setStatus] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pullName, setPullName] = useState('');
  const [pullStatus, setPullStatus] = useState('');
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [err, setErr] = useState('');
  const [testing, setTesting] = useState('');
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    const st = await checkOllama(settings.ollamaUrl);
    setStatus(st);
    if (st.ok) {
      try { setModels(await listOllamaModels(settings.ollamaUrl)); }
      catch (e: any) { setErr(e.message); }
    }
    setLoading(false);
  }, [settings.ollamaUrl]);

  useEffect(() => { refresh(); }, [refresh]);

  const pull = async (name?: string) => {
    const n = (name || pullName).trim();
    if (!n || pulling) return;
    // Vorab-RAM-Prüfung: warnen, wenn zu wenig freier Speicher für ein Modell
    try {
      const info = await (window as any).studio.sys.info();
      const freeGb = info.memFree / 1e9;
      if (freeGb < 3) {
        if (!(await uiConfirm(`Nur ${freeGb.toFixed(1)} GB freier Arbeitsspeicher. Downloads selbst sind unkritisch, aber das Modell läuft evtl. nicht. Trotzdem herunterladen?`))) return;
      }
    } catch { /* sys info optional */ }
    setPulling(true); setPullStatus('Starte Download…'); setPullPct(null); setErr('');
    try {
      await pullOllamaModel(settings.ollamaUrl, n, (status, completed, total) => {
        setPullStatus(status);
        if (total && completed != null) setPullPct(Math.round((completed / total) * 100));
        else setPullPct(null);
      });
      setPullName('');
      setPullStatus('Fertig');
      await refresh();
      // Auto-auswahl des gezogenen Modells
      onChange({ ...settings, ollamaModel: n });
    } catch (e: any) {
      setErr(e.message);
      setPullStatus('Fehlgeschlagen');
    }
    setPulling(false);
  };

  const test = async (name: string) => {
    if (testing) return;
    setTesting(name);
    setTestResults(prev => ({ ...prev, [name]: { ok: false, text: 'Teste…' } }));
    const r = await testOllamaModel(settings.ollamaUrl, name);
    setTestResults(prev => ({ ...prev, [name]: { ok: r.ok, text: r.ok ? `✓ ${r.ms} ms · „${r.reply}"` : `✗ ${r.error}` } }));
    setTesting('');
  };

  const del = async (name: string) => {
    if (!(await uiConfirm(`Modell „${name}“ wirklich löschen?`))) return;
    try {
      await deleteOllamaModel(settings.ollamaUrl, name);
      if (settings.ollamaModel === name) onChange({ ...settings, ollamaModel: '' });
      await refresh();
    } catch (e: any) { setErr(e.message); }
  };

  const installed = new Set(models.map(m => m.name));
  const suggestions = [...new Set([...CODING_MODEL_SUGGESTIONS, ...CHAT_MODEL_SUGGESTIONS])];

  return (
    <div className="glass-card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ flex: 1 }}>Ollama-Modelle</h3>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: status?.ok ? 'var(--ok)' : 'var(--danger)' }}>
          {status === null ? 'Prüfe…' : status.ok ? <><CheckCircle2 size={14} /> Verbunden{status.version ? ` · v${status.version}` : ''}</> : <><XCircle size={14} /> {status.error}</>}
        </span>
        <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={refresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Aktualisieren
        </button>
      </div>

      {!status?.ok && status && (
        <div className="empty-state" style={{ padding: '24px 10px' }}>
          Ollama ist unter <code>{settings.ollamaUrl}</code> nicht erreichbar.<br />
          Bitte Ollama installieren und mit <code>ollama serve</code> starten.
        </div>
      )}

      {status?.ok && (
        <>
          {models.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 10px' }}>
              Keine Modelle installiert. Lade unten ein Modell herunter oder nutze einen Vorschlag.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
              {models.map(m => (
                <div key={m.name} className="glass-chip" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 15px' }}>
                  <HardDrive size={16} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {m.name}
                      {settings.ollamaModel === m.name && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', border: '1px solid var(--glass-edge)' }}>AKTIV</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                      {fmtSize(m.size)}
                      {m.details?.parameter_size ? ` · ${m.details.parameter_size}` : ''}
                      {m.details?.family ? ` · ${m.details.family}` : ''}
                      {m.modified_at ? ` · ${new Date(m.modified_at).toLocaleDateString('de-DE')}` : ''}
                    </div>
                  </div>
                  {settings.ollamaModel !== m.name && (
                    <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => onChange({ ...settings, ollamaModel: m.name })}>
                      <CheckCircle2 size={13} /> Auswählen
                    </button>
                  )}
                  <button className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => test(m.name)} disabled={testing === m.name} title="Modell testen">
                    <Zap size={13} /> {testing === m.name ? '…' : 'Test'}
                  </button>
                  <button className="btn danger" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => del(m.name)} title="Löschen">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {Object.entries(testResults).map(([name, r]) => (
                <div key={'t' + name} style={{ fontSize: 11.5, color: r.ok ? 'var(--ok)' : 'var(--danger)', padding: '0 4px' }}>
                  {name}: {r.text}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, margin: '14px 0 10px' }}>
            <input
              type="text" style={{ flex: 1 }} placeholder="Modellname, z. B. qwen2.5-coder:7b"
              value={pullName} onChange={e => setPullName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && pull()}
              disabled={pulling}
            />
            <button className="btn primary" onClick={() => pull()} disabled={pulling || !pullName.trim()}>
              <Download size={14} /> {pulling ? 'Lädt…' : 'Herunterladen'}
            </button>
          </div>

          {pulling && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-dim)', marginBottom: 5 }}>
                <span>{pullStatus}</span>
                <span>{pullPct != null ? `${pullPct}%` : ''}</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  width: pullPct != null ? `${pullPct}%` : '30%',
                  background: 'linear-gradient(90deg, rgba(255,255,255,.4), rgba(255,255,255,.8))',
                  transition: 'width .3s',
                  ...(pullPct == null ? { animation: 'softPulse 1.2s infinite' } : {}),
                }} />
              </div>
            </div>
          )}
          {!pulling && pullStatus === 'Fertig' && <div style={{ fontSize: 12, color: 'var(--ok)', marginBottom: 10 }}>✓ Modell bereit und ausgewählt.</div>}

          <div>
            <div className="field" style={{ marginTop: 4, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={12} /> Empfohlene Modelle
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {suggestions.map(name => {
                const has = installed.has(name);
                return (
                  <button
                    key={name}
                    className="btn"
                    style={{ padding: '5px 12px', fontSize: 11.5, fontFamily: 'var(--mono)' }}
                    disabled={pulling}
                    onClick={() => has ? onChange({ ...settings, ollamaModel: name }) : pull(name)}
                    title={has ? 'Auswählen' : 'Herunterladen'}
                  >
                    {has ? '✓ ' : <Download size={11} style={{ display: 'inline', marginRight: 3 }} />}{name}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {err && <div className="toast err" style={{ position: 'static', transform: 'none', marginTop: 10, alignSelf: 'flex-start' }}>{err}</div>}
    </div>
  );
}
