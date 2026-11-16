import React, { useState, useEffect, useCallback } from 'react';
import { AISettings } from '../types';
import { generateText } from '../services/ai';
import { uiAlert } from '../uiDialog';

const DESIGN_DIR = 'designs';
const PRESETS = [
  { label: 'Discord-Dashboard', prompt: 'Modernes Dashboard für einen Discord-Bot: Sidebar mit Serverauswahl, Statistik-Karten (Mitglieder, Befehle, uptime), Nutzertabelle, Aktivitätsverlauf, Moderations-Panel. Dunkles Anthrazit, silberne Akzente, Glassmorphism.' },
  { label: 'Admin-Panel', prompt: 'Professionelle Admin-Oberfläche: Navigation, Dashboard mit KPI-Karten, Diagramme (Balken/Linie via SVG oder CSS), Datentabelle mit Suche und Filtern, Einstellungsbereich, Benutzerprofile. Modern, dunkel, hochwertig.' },
  { label: 'Website', prompt: 'Moderne Landingpage: Hero-Bereich, Feature-Sektion, Preise, Footer. Dunkles Design mit silbernen Akzenten, Glassmorphism, Animationen.' },
  { label: 'Login', prompt: 'Elegante Login-Seite: zentriertes Glass-Card, Logo-Platzhalter (SVG), E-Mail/Passwort-Felder, Button, dezente Animationen. Dunkler Hintergrund mit radialem Licht.' },
  { label: 'Statistik-Dashboard', prompt: 'Analytics-Dashboard: große KPI-Karten oben, Liniendiagramm (SVG), Donut-Chart (SVG), Tabelle mit letzten Einträgen, Datumsfilter. Dunkel, minimal, hochwertig.' },
  { label: 'Gaming-Dashboard', prompt: 'Gaming-Community-Dashboard: Server-Status, Spieler-Statistiken, Rangliste, News-Sektion, Chat-Widget. Dunkel mit silbernen Akzenten, moderne Cards.' },
];

const STYLE_BRIEF = 'Stil: luxuriöses Dark-Design — tiefschwarz/anthrazit, weiß, hellgrau, dezente silberne Reflexionen, Glassmorphism (backdrop-filter: blur), abgerundete Ecken, hochwertige Schatten, elegante Typografie (system fonts), responsive. KEINE lila/blauen Neonfarben. Für Bilder/Grafiken darfst du kostenlose Pollinations-URLs nutzen: https://image.pollinations.ai/prompt/{ENCODED_PROMPT}?width=1024&height=1024&nologo=true — oder SVG/CSS selbst gestalten (bevorzugt für Icons/Diagramme). Antworte NUR mit dem vollständigen HTML-Dokument in einem ```html Codeblock.';

interface DesignProject { name: string; file: string; mtime: number }

export function DesignStudio({ settings, pendingDesign, onPendingConsumed }: { settings: AISettings; pendingDesign?: { html: string; name: string } | null; onPendingConsumed?: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [html, setHtml] = useState('');
  const [changeReq, setChangeReq] = useState('');
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [currentName, setCurrentName] = useState('');
  const [designDir, setDesignDir] = useState('');
  const [versions, setVersions] = useState<string[]>([]);
  const studio = () => (window as any).studio;

  const dir = useCallback(async () => {
    if (designDir) return designDir;
    const p = await studio().app.paths();
    const d = p.filesDir + '/' + DESIGN_DIR;
    await studio().fs.mkdir(p.filesDir, DESIGN_DIR).catch(() => {});
    setDesignDir(d);
    return d;
  }, [designDir]);

  const refreshProjects = useCallback(async () => {
    const d = await dir();
    const list = await studio().fs.readDir(d).catch(() => []);
    setProjects(list.filter((f: any) => f.name.endsWith('.html')).map((f: any) => ({ name: f.name.replace(/-v\d+\.html$|\.html$/, ''), file: f.name, mtime: f.mtime || 0 })));
  }, [dir]);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  // Vom Chat übergebene Designs laden
  useEffect(() => {
    if (pendingDesign?.html) {
      setHtml(pendingDesign.html);
      setCurrentName(pendingDesign.name || 'chat-design');
      setTab('preview');
      onPendingConsumed?.();
    }
  }, [pendingDesign]);

  const extractHtml = (out: string) => {
    const m = out.match(/```(?:html)?\n([\s\S]*?)```/);
    const code = m ? m[1] : out;
    if (!code.includes('<')) throw new Error('Keine HTML-Antwort erhalten');
    return code;
  };

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const out = await generateText(settings,
        `Erstelle eine komplette, eigenständige HTML-Seite (mit eingebettetem CSS und JS falls nötig). ${STYLE_BRIEF}\n\nAufgabe: ${prompt}`,
        'Du bist ein Senior-UI-Designer und Frontend-Entwickler. Antworte nur mit Code. Erstelle hochwertige, COMPLETE Designs — keine Platzhalter.');
      const code = extractHtml(out);
      setHtml(code); setTab('preview');
      if (!currentName) setCurrentName(prompt.slice(0, 40));
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const iterate = async () => {
    if (!changeReq.trim() || !html || busy) return;
    setBusy(true); setError('');
    try {
      const out = await generateText(settings,
        `Du bekommst eine bestehende HTML-Seite und eine Änderungs-Anforderung. Gib die KOMPLETTE aktualisierte HTML-Seite zurück — nur gezielt ändern, Rest unverändert lassen. ${STYLE_BRIEF}\n\nÄnderung: ${changeReq}\n\nBisheriger Code (gekürzt):\n${html.slice(0, 14000)}`,
        'Du bist ein Senior-UI-Designer. Antworte nur mit dem vollständigen HTML-Dokument.');
      const code = extractHtml(out);
      setHtml(code); setChangeReq('');
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const saveProject = async (asVersion = false) => {
    if (!html) return;
    const d = await dir();
    const base = (currentName || 'design').replace(/[^\wäöüÄÖÜß -]/g, '').trim() || 'design';
    let fname = base + '.html';
    if (asVersion) {
      const n = versions.length + 1;
      fname = `${base}-v${n}.html`;
    }
    await studio().fs.writeFile(`${d}/${fname}`, html);
    uiAlert(`Gespeichert: designs/${fname}`);
    refreshProjects();
    const vs = await studio().fs.readDir(d).catch(() => []);
    setVersions(vs.filter((f: any) => f.name.startsWith(base) && f.name.includes('-v')).map((f: any) => f.name));
  };

  const loadProject = async (file: string) => {
    const d = await dir();
    const c = await studio().fs.readFile(`${d}/${file}`, 1_500_000).catch(() => '');
    if (!c) { uiAlert('Datei konnte nicht geladen werden: ' + file); return; }
    setHtml(c); setCurrentName(file.replace(/-v\d+\.html$|\.html$/, '')); setTab('preview');
  };

  const exportHtml = async () => {
    const p = await studio().fs.saveFile((currentName || 'design') + '.html', html);
    if (p) uiAlert('Gespeichert: ' + p);
  };

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="page-title">Design Studio</div>
        <div className="page-sub">Beschreibe ein Design — die KI generiert eine funktionsfähige HTML-Seite mit Live-Vorschau. Iteriere per Änderungswunsch, speichere Versionen.</div>
      </div>

      <div className="glass-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {PRESETS.map(p => (
            <button key={p.label} className="btn" style={{ padding: '5px 12px', fontSize: 12 }} disabled={busy}
              onClick={() => { setPrompt(p.prompt); }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="text" style={{ flex: 1 }} placeholder="Design beschreiben — z. B. Dashboard für Discord-Bot, Login-Seite, Admin-Panel…"
            value={prompt} onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generate()} />
          <button className="btn primary" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? 'Generiere…' : 'Generieren'}</button>
        </div>
      </div>

      {projects.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>Projekte:</span>
          {projects.slice(0, 10).map(p => (
            <button key={p.file} className="btn" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => loadProject(p.file)}>{p.name}</button>
          ))}
        </div>
      )}

      {error && <div className="toast err" style={{ position: 'static', transform: 'none', alignSelf: 'flex-start' }}>{error}</div>}

      {html && (
        <>
          <div className="glass-card" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" style={{ flex: 1, minWidth: 200 }} placeholder="Änderung beschreiben — z. B. dunkler, silberne Akzente, Karten moderner…"
              value={changeReq} onChange={e => setChangeReq(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && iterate()} disabled={busy} />
            <button className="btn primary" onClick={iterate} disabled={busy || !changeReq.trim()}>Ändern</button>
            <button className="btn" onClick={() => saveProject(false)}>Speichern</button>
            <button className="btn" onClick={() => saveProject(true)}>Version</button>
            <button className="btn" onClick={exportHtml}>Export</button>
          </div>
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <button className={`btn ${tab === 'preview' ? 'primary' : ''}`} style={{ padding: '4px 14px', fontSize: 12 }} onClick={() => setTab('preview')}>Vorschau</button>
              <button className={`btn ${tab === 'code' ? 'primary' : ''}`} style={{ padding: '4px 14px', fontSize: 12 }} onClick={() => setTab('code')}>Code</button>
              <div style={{ flex: 1 }} />
              {versions.length > 0 && (
                <select style={{ fontSize: 12 }} value="" onChange={e => e.target.value && loadProject(e.target.value)}>
                  <option value="">Versionen…</option>
                  {versions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </div>
            {tab === 'preview' ? (
              <iframe className="preview-frame" style={{ flex: 1, border: 'none', borderRadius: 0 }} sandbox="allow-scripts" srcDoc={html} title="Design-Vorschau" />
            ) : (
              <textarea className="editor" style={{ flex: 1, border: 'none', borderRadius: 0 }} value={html} onChange={e => setHtml(e.target.value)} spellCheck={false} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
