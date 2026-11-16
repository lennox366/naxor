import React, { useState } from 'react';
import { AISettings } from '../types';
import { generateText } from '../services/ai';
import { uiConfirm, uiAlert } from '../uiDialog';

export function Documents({ settings }: { settings: AISettings }) {
  const [content, setContent] = useState('# Neues Dokument\n\nBeginne hier zu schreiben…');
  const [aiPrompt, setAiPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('dokument.md');

  const aiAssist = async () => {
    if (!aiPrompt.trim()) return;
    setBusy(true);
    try {
      const out = await generateText(settings,
        `Du bist ein Dokumenten-Assistent. Aktuelles Dokument (Markdown):\n\`\`\`md\n${content.slice(0, 10000)}\n\`\`\`\n\nAnweisung: ${aiPrompt}\n\nAntworte mit dem kompletten aktualisierten Dokument in einem \`\`\`md Codeblock.`,
        'Du bist ein präziser Dokumenten-Assistent. Antworte nur mit dem Dokument.');
      const m = out.match(/```(?:md|markdown)?\n([\s\S]*?)```/);
      const doc = m ? m[1] : out;
      if (await uiConfirm('KI-Vorschlag übernehmen?')) setContent(doc);
    } catch (e: any) { uiAlert('KI-Fehler: ' + e.message); }
    setBusy(false);
  };

  const save = async (ext: string, transform?: (c: string) => string) => {
    const body = transform ? transform(content) : content;
    const p = await (window as any).studio.fs.saveFile(fileName.replace(/\.\w+$/, '') + ext, body);
    if (p) uiAlert('Gespeichert: ' + p);
  };

  const toHtml = (md: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>body{max-width:760px;margin:40px auto;padding:0 20px;font-family:'Segoe UI',sans-serif;line-height:1.7;color:#222}pre{background:#f4f4f4;padding:12px;border-radius:8px;overflow-x:auto}code{font-family:Consolas,monospace}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 12px}</style></head><body>${mdToHtml(md)}</body></html>`;

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="page-title">Dokumente</div>
          <div className="page-sub">Markdown-Editor mit KI-Unterstützung und Export.</div>
        </div>
        <input type="text" value={fileName} onChange={e => setFileName(e.target.value)} style={{ width: 200 }} />
        <button className="btn" onClick={() => save('.md')}>.md</button>
        <button className="btn" onClick={() => save('.html', toHtml)}>HTML</button>
        <button className="btn" onClick={() => save('.txt', c => c.replace(/[#*`\[\]]/g, ''))}>.txt</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <textarea className="editor" style={{ flex: 1, fontFamily: 'var(--font)', fontSize: 14, lineHeight: 1.7 }}
          value={content} onChange={e => setContent(e.target.value)} spellCheck={false} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" style={{ flex: 1 }} placeholder="KI-Anweisung (z. B. „Füge eine Zusammenfassung hinzu“)…"
            value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && aiAssist()} />
          <button className="btn primary" onClick={aiAssist} disabled={busy || !aiPrompt.trim()}>{busy ? 'KI arbeitet…' : 'KI auf Dokument anwenden'}</button>
        </div>
      </div>
    </div>
  );
}

// Minimaler Markdown→HTML Konverter für den Export
function mdToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}
