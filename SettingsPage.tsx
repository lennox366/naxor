import React, { useEffect, useState } from 'react';
import { AISettings, defaultSettings } from '../types';
import { loadSettings, saveSettings } from '../services/ai';
import { ModelManager } from '../components/ModelManager';
import { LocalProviderPanel } from '../components/LocalProviderPanel';
import { getVoices, sttSupported, speak, stopSpeaking } from '../services/speech';

export function SettingsPage({ settings, onChange }: { settings: AISettings; onChange: (s: AISettings) => void }) {
  const [s, setS] = useState<AISettings>(settings);
  const [saved, setSaved] = useState(false);
  const [voiceTest, setVoiceTest] = useState('');
  const voices = getVoices();

  const testVoice = () => {
    // Erst persistieren, damit der Test exakt den gespeicherten Stand prüft
    // (gleicher Pfad wie die Sprachausgabe im Chat).
    saveSettings(s); onChange(s);
    setVoiceTest('lädt…');
    speak('Hallo! Ich bin 230% Offiziell. Kannst du mich hören?', s, () => setVoiceTest('Wiedergabe beendet.'), (m) => setVoiceTest('Fehler: ' + m));
  };

  useEffect(() => { setS(settings); }, [settings]);

  const upd = (k: keyof AISettings, v: any) => setS(prev => ({ ...prev, [k]: v }));

  const persist = () => { saveSettings(s); onChange(s); setSaved(true); setTimeout(() => setSaved(false), 1500); };

  return (
    <div className="view narrow">
      <div className="page-title">Einstellungen</div>
      <div className="page-sub">KI-Provider, API-Schlüssel und Sprache. Schlüssel werden lokal in der SQLite-Datenbank gespeichert.</div>

      <div className="glass-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 4 }}>KI-Provider</h3>
        <div className="grid-2">
          <div>
            <label className="field">Provider</label>
            <select value={s.provider} onChange={e => upd('provider', e.target.value)} style={{ width: '100%' }}>
              <option value="ollama">Ollama (lokal)</option>
              <option value="local">Lokal Universal (GGUF-Modelle, CPU-fähig)</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Eigener Endpoint (OpenAI-kompatibel)</option>
            </select>
          </div>
          {s.provider === 'ollama' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">Ollama URL</label>
              <input type="text" style={{ width: '100%' }} value={s.ollamaUrl} onChange={e => upd('ollamaUrl', e.target.value)} />
              <ModelManager
                settings={s}
                onChange={(ns) => { setS(ns); saveSettings(ns); onChange(ns); }}
              />
            </div>
          )}
          {s.provider === 'local' && <LocalProviderPanel s={s} setS={setS} onChange={onChange} />}
          {s.provider === 'openai' && (
            <>
              <div>
                <label className="field">API-Key</label>
                <input type="password" style={{ width: '100%' }} value={s.openaiKey} onChange={e => upd('openaiKey', e.target.value)} placeholder="sk-…" />
              </div>
              <div>
                <label className="field">Modell</label>
                <input type="text" style={{ width: '100%' }} value={s.openaiModel} onChange={e => upd('openaiModel', e.target.value)} />
              </div>
            </>
          )}
          {s.provider === 'custom' && (
            <>
              <div>
                <label className="field">Base URL</label>
                <input type="text" style={{ width: '100%' }} value={s.customUrl} onChange={e => upd('customUrl', e.target.value)} placeholder="http://localhost:1234/v1" />
              </div>
              <div>
                <label className="field">API-Key (optional)</label>
                <input type="password" style={{ width: '100%' }} value={s.customKey} onChange={e => upd('customKey', e.target.value)} />
              </div>
              <div>
                <label className="field">Modell</label>
                <input type="text" style={{ width: '100%' }} value={s.customModel} onChange={e => upd('customModel', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--ink-mute)', lineHeight: 1.7 }}>
                <b>CPU-only Tipp (schwache/alte GPUs):</b> Ollama mit der GTX 750 Ti stürzt wegen fehlender CUDA-Unterstützung ab.
                Workaround: llama-server direkt starten —
                <code style={{ display: 'block', marginTop: 6, padding: '8px 10px', background: 'rgba(255,255,255,.05)', borderRadius: 8, fontSize: 11 }}>
                  &quot;C:\Users\User\AppData\Local\Programs\Ollama\lib\ollama\llama-server.exe&quot; -m &quot;C:\Users\User\.ollama\models\blobs\sha256-4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba&quot; --port 8080 -ngl 0 -c 8192
                </code>
                Dann hier: Base URL <code>http://localhost:8080/v1</code>, Modell z. B. <code>qwen2.5-coder-3b</code>.
              </div>
            </>
          )}
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-mute)' }}>
          Hinweis: Die App funktioniert vollständig offline mit Ollama. Ohne konfigurierten Provider erscheint eine verständliche Fehlermeldung im Chat.
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 4 }}>Sprache</h3>
        <div className="grid-2">
          <div>
            <label className="field">TTS-Engine</label>
            <select style={{ width: '100%' }} value={s.ttsEngine || 'system'} onChange={e => upd('ttsEngine', e.target.value as any)}>
              <option value="system">System-Stimme (offline, Windows)</option>
              <option value="elevenlabs">ElevenLabs — 230%-Stimme (Cloud)</option>
            </select>
          </div>
          <div>
            <label className="field">Lautstärke: {Math.round((s.ttsVolume ?? 1) * 100)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={s.ttsVolume ?? 1} onChange={e => upd('ttsVolume', parseFloat(e.target.value))} style={{ width: '100%' }} />
          </div>
          {(s.ttsEngine || 'system') === 'elevenlabs' && (
            <>
              <div>
                <label className="field">ElevenLabs API-Key</label>
                <input type="password" style={{ width: '100%' }} value={s.elevenKey} onChange={e => upd('elevenKey', e.target.value)} placeholder="xi-api-key…" />
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>Wird nur lokal in der SQLite-Einstellungen gespeichert und im Hauptprozess für API-Aufrufe verwendet. Nicht im Code.</div>
              </div>
              <div>
                <label className="field">Voice-ID (230%-Stimme)</label>
                <input type="text" style={{ width: '100%' }} value={s.elevenVoiceId} onChange={e => upd('elevenVoiceId', e.target.value)} placeholder="lzfdHZ2QD3sqy4zwTwi2" />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" onClick={testVoice}>Stimme testen</button>
                <button className="btn" onClick={() => { stopSpeaking(); setVoiceTest('Gestoppt.'); }}>Stopp</button>
                {voiceTest && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{voiceTest}</span>}
                <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>ElevenLabs ist kostenpflichtig (pro Zeichen) — Aufrufe erfolgen nur bei aktiver Sprachausgabe.</span>
              </div>
            </>
          )}
          {(s.ttsEngine || 'system') === 'system' && (
          <div>
            <label className="field">Sprachausgabe-Stimme</label>
            <select style={{ width: '100%' }} value={s.voiceURI} onChange={e => upd('voiceURI', e.target.value)}>
              <option value="">Automatisch (Deutsch bevorzugt)</option>
              {voices.map((v: SpeechSynthesisVoice) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </div>
          )}
          {(s.ttsEngine || 'system') === 'system' && (
          <>
          <div>
            <label className="field">Sprechgeschwindigkeit: {s.voiceRate.toFixed(1)}×</label>
            <input type="range" min="0.5" max="2" step="0.1" value={s.voiceRate} onChange={e => upd('voiceRate', parseFloat(e.target.value))} style={{ width: '100%' }} />
          </div>
          <div>
            <label className="field">Stimmlage: {s.voicePitch.toFixed(1)}</label>
            <input type="range" min="0.5" max="1.5" step="0.1" value={s.voicePitch} onChange={e => upd('voicePitch', parseFloat(e.target.value))} style={{ width: '100%' }} />
          </div>
          </>
          )}
          <div>
            <label className="field">STT-Endpunkt (optional, Whisper-kompatibel)</label>
            <input type="text" style={{ width: '100%' }} value={s.sttEndpoint} onChange={e => upd('sttEndpoint', e.target.value)} placeholder="http://localhost:8000/v1/audio/transcriptions" />
            <input type="password" style={{ width: '100%', marginTop: 6 }} value={s.sttKey} onChange={e => upd('sttKey', e.target.value)} placeholder="API-Key (optional)" />
          </div>
          <div>
            <label className="field">Status</label>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
              Web Speech API: {sttSupported() ? 'verfügbar' : 'nicht verfügbar'}<br />
              TTS: {('speechSynthesis' in window) ? 'verfügbar' : 'nicht verfügbar'}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card">
        <h3 style={{ marginBottom: 4 }}>Über</h3>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          230% Offiziell v0.1.0 · Electron + React + TypeScript · Chatverlauf in SQLite · Mikrofon via Web Speech API oder Whisper-Endpunkt.
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '14px 0', background: 'linear-gradient(transparent, var(--bg-0) 40%)' }}>
        <button className="btn primary" onClick={persist} style={{ padding: '11px 28px' }}>{saved ? '✓ Gespeichert' : 'Speichern'}</button>
      </div>
    </div>
  );
}
