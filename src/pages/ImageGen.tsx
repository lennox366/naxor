import React, { useState } from 'react';
import { AISettings, defaultSettings } from '../types';
import { loadSettings } from '../services/ai';

export function ImageGen({ settings }: { settings: AISettings }) {
  const [prompt, setPrompt] = useState('');
  const [imgUrl, setImgUrl] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  const s = loadSettings() as any;
  const customEndpoint: string = s.imageEndpoint || '';

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true); setError('');
    try {
      let url: string;
      if (customEndpoint) {
        // OpenAI-compatible images endpoint
        const res = await fetch(customEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(s.imageKey ? { Authorization: `Bearer ${s.imageKey}` } : {}) },
          body: JSON.stringify({ model: s.imageModel || 'dall-e-3', prompt, size, n: 1 }),
        });
        if (!res.ok) throw new Error(`Bild-API Fehler: ${res.status}`);
        const j = await res.json();
        url = j.data?.[0]?.url || j.data?.[0]?.b64_json && `data:image/png;base64,${j.data[0].b64_json}`;
        if (!url) throw new Error('Keine Bild-URL in Antwort');
      } else {
        // Pollinations.ai – kostenloser Bildgenerator, kein Key nötig
        const seed = Math.floor(Math.random() * 1e9);
        url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size.split('x')[0]}&height=${size.split('x')[1]}&seed=${seed}&nologo=true&model=flux`;
      }
      setImgUrl(url);
      setHistory(h => [url, ...h].slice(0, 12));
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="view narrow" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="page-title">Bildgenerierung</div>
        <div className="page-sub">Prompt eingeben, Bild generieren. Standard: Pollinations.ai (kostenlos). Eigener Endpoint in den Einstellungen möglich.</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input type="text" style={{ flex: 1 }} placeholder="Detaillierte Bildbeschreibung…"
          value={prompt} onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()} />
        <select value={size} onChange={e => setSize(e.target.value)}>
          <option value="1024x1024">1:1</option>
          <option value="1280x720">16:9</option>
          <option value="720x1280">9:16</option>
          <option value="1024x768">4:3</option>
        </select>
        <button className="btn primary" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? 'Generiere…' : 'Generieren'}</button>
      </div>
      {error && <div className="toast err" style={{ position: 'static', transform: 'none', alignSelf: 'flex-start' }}>{error}</div>}
      {imgUrl && (
        <div className="glass-card" style={{ padding: 12 }}>
          <img src={imgUrl} alt={prompt} style={{ width: '100%', borderRadius: 10, display: 'block' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <a className="btn" href={imgUrl} target="_blank" rel="noreferrer" download={`bild-${Date.now()}.png`}>Herunterladen</a>
            <button className="btn" onClick={() => { navigator.clipboard.writeText(imgUrl); }}>URL kopieren</button>
          </div>
        </div>
      )}
      {history.length > 1 && (
        <div>
          <div className="page-sub" style={{ marginBottom: 8 }}>Verlauf</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {history.slice(1).map((u, i) => (
              <img key={i} src={u} alt="" style={{ width: '100%', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)' }}
                onClick={() => setImgUrl(u)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
