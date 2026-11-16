import React, { useState } from 'react';
import { AISettings } from '../types';
import { generateText } from '../services/ai';
import { uiAlert } from '../uiDialog';

export function DesignStudio({ settings }: { settings: AISettings }) {
  const [prompt, setPrompt] = useState('');
  const [html, setHtml] = useState('');
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true); setError('');
    try {
      const out = await generateText(settings,
        `Erstelle eine komplette, eigenständige HTML-Seite (mit eingebettetem CSS und JS falls nötig) für folgendes Design-Briefing. Stil: luxuriöses Dark-Glassmorphism — tiefschwarz, anthrazit, weiß, hellgrau, dezente silberne Reflexionen, Backdrop-Blur, abgerundete Ecken. KEINE lila/blauen Akzente, keine Neonfarben. Antworte NUR mit dem vollständigen HTML-Dokument in einem \`\`\`html Codeblock.\n\nBriefing: ${prompt}`,
        'Du bist ein Senior-UI-Designer. Antworte nur mit Code.');
      const m = out.match(/```(?:html)?\n([\s\S]*?)```/);
      const code = m ? m[1] : out;
      if (!code.includes('<')) throw new Error('Keine HTML-Antwort erhalten');
      setHtml(code);
      setTab('preview');
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const exportHtml = async () => {
    const p = await (window as any).studio.fs.saveFile('design.html', html);
    if (p) uiAlert('Gespeichert: ' + p);
  };

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="page-title">Design Studio</div>
        <div className="page-sub">Beschreibe ein Design — die KI generiert eine funktionsfähige HTML-Seite mit Live-Vorschau.</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input type="text" style={{ flex: 1 }} placeholder="z. B. Landingpage für ein KI-Coding-Tool mit Hero, Features und Pricing…"
          value={prompt} onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()} />
        <button className="btn primary" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? 'Generiere…' : 'Generieren'}</button>
      </div>
      {error && <div className="toast err" style={{ position: 'static', transform: 'none', alignSelf: 'flex-start' }}>{error}</div>}
      {html && (
        <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <button className={`btn ${tab === 'preview' ? 'primary' : ''}`} style={{ padding: '4px 14px', fontSize: 12 }} onClick={() => setTab('preview')}>Vorschau</button>
            <button className={`btn ${tab === 'code' ? 'primary' : ''}`} style={{ padding: '4px 14px', fontSize: 12 }} onClick={() => setTab('code')}>Code</button>
            <div style={{ flex: 1 }} />
            <button className="btn" style={{ padding: '4px 14px', fontSize: 12 }} onClick={exportHtml}>HTML exportieren</button>
          </div>
          {tab === 'preview' ? (
            <iframe className="preview-frame" style={{ flex: 1, border: 'none', borderRadius: 0 }} sandbox="allow-scripts" srcDoc={html} title="Design-Vorschau" />
          ) : (
            <textarea className="editor" style={{ flex: 1, border: 'none', borderRadius: 0 }} value={html} onChange={e => setHtml(e.target.value)} spellCheck={false} />
          )}
        </div>
      )}
    </div>
  );
}
