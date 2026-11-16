import React, { useEffect, useState } from 'react';
import { AISettings, defaultSettings } from '../types';
import { loadSettings, saveSettings } from '../services/ai';
import { ModelManager } from '../components/ModelManager';
import { LocalProviderPanel } from '../components/LocalProviderPanel';
import { getVoices, sttSupported, speak, stopSpeaking, listMics, requestMicPermission, startMicLevel, MicDevice } from '../services/speech';

export function SettingsPage({ settings, onChange }: { settings: AISettings; onChange: (s: AISettings) => void }) {
  const [s, setS] = useState<AISettings>(settings);
  const [saved, setSaved] = useState(false);
  const [voiceTest, setVoiceTest] = useState('');
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [micTesting, setMicTesting] = useState(false);
  const micStopRef = React.useRef<(() => void) | null>(null);
  const voices = getVoices();

  const refreshMics = async () => {
    const ok = await requestMicPermission();
    if (!ok) { setVoiceTest('Mikrofon-Berechtigung verweigert.'); return; }
    setMics(await listMics());
  };
  useEffect(() => { refreshMics(); return () => micStopRef.current?.(); }, []);

  const toggleMicTest = async () => {
    if (micTesting) { micStopRef.current?.(); micStopRef.current = null; setMicTesting(false); setMicLevel(0); return; }
    try {
      micStopRef.current = await startMicLevel(s.micDeviceId || '', setMicLevel);
      setMicTesting(true);
    } catch (e: any) { setVoiceTest('Mikrofon-Test fehlgeschlagen: ' + (e?.message || e)); }
  };

  const testVoice = () => {
    // Erst persistieren, damit der Test exakt den gespeicherten Stand prüft
    // (gleicher Pfad wie die Sprachausgabe im Chat).
    saveSettings(s); onChange(s);
    setVoiceTest('lädt…');
    speak('Hallo! Ich bin NAXORA. Kannst du mich hören?', s, () => setVoiceTest('Wiedergabe beendet.'), (m) => setVoiceTest('Fehler: ' + m));
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
              <option value="edge">Edge-Stimme (kostenlos, ONLINE — Microsoft)</option>
              <option value="elevenlabs">ElevenLabs — NAXORA-Stimme (Cloud, kostenpflichtig)</option>
              <option value="clone" disabled>Lokale Stimmklon-Engine (noch nicht verfügbar)</option>
            </select>
          </div>
          <div>
            <label className="field">Lautstärke: {Math.round((s.ttsVolume ?? 1) * 100)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={s.ttsVolume ?? 1} onChange={e => upd('ttsVolume', parseFloat(e.target.value))} style={{ width: '100%' }} />
          </div>
          {(s.ttsEngine || 'system') === 'edge' && (
            <>
              <div>
                <label className="field">Edge-Stimme (deutsch)</label>
                <select style={{ width: '100%' }} value={s.edgeVoice || 'de-DE-KatjaNeural'} onChange={e => upd('edgeVoice', e.target.value)}>
                  <option value="de-DE-KatjaNeural">Katja (weiblich)</option>
                  <option value="de-DE-ConradNeural">Conrad (männlich)</option>
                  <option value="de-DE-AmalaNeural">Amala (weiblich)</option>
                  <option value="de-DE-KillianNeural">Killian (männlich)</option>
                  <option value="de-DE-LouisaNeural">Louisa (weiblich)</option>
                  <option value="de-DE-FlorianMultilingualNeural">Florian (männlich, mehrsprachig)</option>
                  <option value="de-DE-SeraphinaMultilingualNeural">Seraphina (weiblich, mehrsprachig)</option>
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>Online-Dienst (Microsoft), kostenlos, kein API-Key. <b>Keine Stimmklon-Stimme.</b></div>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" onClick={testVoice}>Stimme testen</button>
                <button className="btn" onClick={() => { stopSpeaking(); setVoiceTest('Gestoppt.'); }}>Stopp</button>
                {voiceTest && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{voiceTest}</span>}
              </div>
            </>
          )}
          {(s.ttsEngine || 'system') === 'clone' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">Stimmreferenz (MP3/WAV)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" style={{ flex: 1 }} value={s.cloneRefPath} onChange={e => upd('cloneRefPath', e.target.value)} placeholder="C:\…\referenz.mp3" readOnly />
                <button className="btn" onClick={async () => { const f = await (window as any).studio.fs.pickFiles({ filters: [{ name: 'Audio', extensions: ['mp3','wav','ogg','m4a','flac'] }] }); if (f?.[0]) upd('cloneRefPath', f[0]); }}>Auswählen</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8, lineHeight: 1.7 }}>
                <b>Noch nicht verfügbar.</b> Lokales Voice Cloning (XTTS-v2/OpenVoice) benötigt: Python ≤3.11 (~30 MB), ~8 GB Festplatte, XTTS-Modell (~1,8 GB), 4–6 GB RAM. Dein PC: Python 3.14, 3,5 GB frei — <b>noch nicht installierbar ohne deine Zustimmung</b>. Lizenz: XTTS-v2 nicht-kommerziell. Die Referenz-MP3 wird erst nach Einrichtung der Engine verwendet — aktuell wird sie <b>nicht</b> abgespielt oder „geklont".
              </div>
            </div>
          )}
          {(s.ttsEngine || 'system') === 'elevenlabs' && (
            <>
              <div>
                <label className="field">ElevenLabs API-Key</label>
                <input type="password" style={{ width: '100%' }} value={s.elevenKey} onChange={e => upd('elevenKey', e.target.value)} placeholder="xi-api-key…" />
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>Wird nur lokal in der SQLite-Einstellungen gespeichert und im Hauptprozess für API-Aufrufe verwendet. Nicht im Code.</div>
              </div>
              <div>
                <label className="field">Voice-ID (NAXORA-Stimme)</label>
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
            <label className="field">Mikrofon</label>
            <select style={{ width: '100%' }} value={s.micDeviceId || ''} onChange={e => upd('micDeviceId', e.target.value)}>
              <option value="">Standardgerät des Systems</option>
              {mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <button className="btn" style={{ padding: '4px 12px', fontSize: 12 }} onClick={refreshMics}>Aktualisieren</button>
              <button className="btn" style={{ padding: '4px 12px', fontSize: 12 }} onClick={toggleMicTest}>{micTesting ? 'Test stoppen' : 'Pegeltest'}</button>
              {micTesting && <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${Math.round(micLevel * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#c0c0c0,#fff)', transition: 'width .05s' }} /></div>}
            </div>
            {mics.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>Keine Geräte erkannt — Berechtigung erteilen oder „Aktualisieren" klicken.</div>}
          </div>
          <div>
            <label className="field">Automatische Sprachausgabe</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={!!s.autoSpeak} onChange={e => upd('autoSpeak', e.target.checked)} />
              KI-Antworten automatisch vorlesen
            </label>
          </div>
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

      <div className="glass-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 4 }}>Bildgenerierung</h3>
        <div className="grid-2">
          <div>
            <label className="field">Endpoint (optional, OpenAI-kompatibel)</label>
            <input type="text" style={{ width: '100%' }} value={s.imageEndpoint} onChange={e => upd('imageEndpoint', e.target.value)} placeholder="leer = Pollinations.ai (kostenlos)" />
          </div>
          <div>
            <label className="field">API-Key (optional)</label>
            <input type="password" style={{ width: '100%' }} value={s.imageKey} onChange={e => upd('imageKey', e.target.value)} placeholder="nur für eigenen Endpoint" />
          </div>
          <div>
            <label className="field">Modell (optional)</label>
            <input type="text" style={{ width: '100%' }} value={s.imageModel} onChange={e => upd('imageModel', e.target.value)} placeholder="z. B. dall-e-3" />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8, lineHeight: 1.6 }}>
          Standard: <b>Pollinations.ai</b> — kostenlos, kein Key nötig. Eigener Endpoint nur mit gültigem Key; Aufrufe erfolgen nur bei aktiver Bildgenerierung.
        </div>
      </div>

      <div className="glass-card">
        <h3 style={{ marginBottom: 4 }}>Über</h3>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          NAXORA — The Future of Intelligence · v0.1.0 · Electron + React + TypeScript · Chatverlauf in SQLite · Mikrofon via Web Speech API oder Whisper-Endpunkt.
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '14px 0', background: 'linear-gradient(transparent, var(--bg-0) 40%)' }}>
        <button className="btn primary" onClick={persist} style={{ padding: '11px 28px' }}>{saved ? '✓ Gespeichert' : 'Speichern'}</button>
      </div>
    </div>
  );
}
