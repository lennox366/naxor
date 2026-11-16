import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AISettings } from '../types';
import { generateText } from '../services/ai';
import { uiAlert } from '../uiDialog';

interface Slide { title: string; bullets: string[]; notes?: string }

export function Presentations({ settings }: { settings: AISettings }) {
  const [topic, setTopic] = useState('');
  const [slides, setSlides] = useState<Slide[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!topic.trim()) return;
    setBusy(true); setError('');
    try {
      const out = await generateText(settings,
        `Erstelle eine Präsentation zu folgendem Thema. Antworte AUSSCHLIESSLICH mit einem JSON-Array von 6-10 Slides. Jedes Slide: {"title": string, "bullets": string[], "notes": string}. Bullets kurz und prägnant. Thema: ${topic}`,
        'Du bist ein Präsentations-Coach. Antworte nur mit validem JSON.');
      const m = out.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('Keine JSON-Antwort');
      const parsed = JSON.parse(m[0]);
      setSlides(parsed);
      setIdx(0);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const exportHtml = async () => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const slidesHtml = slides.map(s => `
      <section class="slide">
        <h1>${esc(s.title)}</h1>
        <ul>${s.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}
      </section>`).join('\n');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Präsentation</title>
<style>
body{margin:0;background:#07080a;color:#f2f3f5;font-family:'Segoe UI',sans-serif}
.slide{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:8vh 10vw;page-break-after:always;border-bottom:1px solid rgba(255,255,255,.1)}
h1{font-size:3rem;margin-bottom:2rem}.slide ul{list-style:none;font-size:1.4rem;line-height:2}
.slide li:before{content:"—";margin-right:1rem;opacity:.5}.notes{margin-top:3rem;font-size:.95rem;color:#9aa0a8;border-top:1px solid rgba(255,255,255,.15);padding-top:1rem}
@media print{.slide{min-height:100vh}}
</style></head><body>${slidesHtml}</body></html>`;
    const p = await (window as any).studio.fs.saveFile('praesentation.html', doc);
    if (p) uiAlert('Gespeichert: ' + p + ' — im Browser öffnen oder drucken (Strg+P → PDF).');
  };

  const exportMd = async () => {
    const md = slides.map((s, i) => `## ${i + 1}. ${s.title}\n\n${s.bullets.map(b => `- ${b}`).join('\n')}\n${s.notes ? `\n*Notizen: ${s.notes}*\n` : ''}`).join('\n---\n\n');
    const p = await (window as any).studio.fs.saveFile('praesentation.md', '# Präsentation\n\n' + md);
    if (p) uiAlert('Gespeichert: ' + p);
  };

  const cur = slides[idx];

  return (
    <div className="view narrow" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="page-title">Präsentationen</div>
        <div className="page-sub">Thema eingeben — die KI erstellt Gliederung, Folien und Notizen.</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input type="text" style={{ flex: 1 }} placeholder="Thema der Präsentation…"
          value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && generate()} />
        <button className="btn primary" onClick={generate} disabled={busy || !topic.trim()}>{busy ? 'Erstelle…' : 'Generieren'}</button>
      </div>
      {error && <div className="toast err" style={{ position: 'static', transform: 'none', alignSelf: 'flex-start' }}>{error}</div>}
      {slides.length > 0 && cur && (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn" style={{ padding: '6px 10px' }} onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}><ChevronLeft size={15} /></button>
            <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>Folie {idx + 1} / {slides.length}</span>
            <button className="btn" style={{ padding: '6px 10px' }} onClick={() => setIdx(Math.min(slides.length - 1, idx + 1))} disabled={idx === slides.length - 1}><ChevronRight size={15} /></button>
            <div style={{ flex: 1 }} />
            <button className="btn" style={{ padding: '4px 12px', fontSize: 12 }} onClick={exportMd}>Markdown</button>
            <button className="btn primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={exportHtml}>HTML exportieren</button>
          </div>
          <div style={{ padding: '36px 40px', minHeight: 320 }}>
            <h2 style={{ fontSize: 26, marginBottom: 24 }}>{cur.title}</h2>
            <ul style={{ listStyle: 'none', fontSize: 16, lineHeight: 2.1 }}>
              {cur.bullets.map((b, i) => <li key={i} style={{ paddingLeft: 18, position: 'relative' }}><span style={{ position: 'absolute', left: 0, opacity: .4 }}>—</span>{b}</li>)}
            </ul>
            {cur.notes && <div style={{ marginTop: 28, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-dim)' }}>Notizen: {cur.notes}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '12px 24px', borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
            {slides.map((s, i) => (
              <button key={i} onClick={() => setIdx(i)}
                style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: i === idx ? 'var(--glass-3)' : 'transparent', color: 'var(--text-dim)', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {i + 1}. {s.title.slice(0, 30)}
              </button>
            ))}
          </div>
        </div>
      )}
      {slides.length === 0 && !busy && <div className="empty-state">Noch keine Präsentation. Gib ein Thema ein.</div>}
    </div>
  );
}
