import React, { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { Folder, FolderOpen, FolderPlus, FileText, FileCode2, FileJson, FileImage, ChevronRight, RefreshCw, Save, Bot, TerminalSquare, GitCompareArrows, SendHorizontal, Square, FilePlus2, Trash2, X } from 'lucide-react';
import { AISettings } from '../types';
import { loadProjects } from './ProjectsPage';
import { runAgent, readBackup, applySandboxChanges, discardSandbox, AgentEvent } from '../agent';
import { saveSettings } from '../services/ai';
import { uiConfirm, uiAlert } from '../uiDialog';
import { DiffView } from '../components/DiffView';

interface Project { name: string; path: string }
interface TreeNode { name: string; path: string; isDir: boolean; depth: number }
interface TreeItem extends TreeNode { children: TreeItem[] }
interface AgentMsg {
  id: number; kind: 'user' | 'assistant' | 'tool' | 'error' | 'verify';
  text: string; tool?: string; args?: any; result?: string; ok?: boolean;
}

const LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  html: 'xml', xml: 'xml', css: 'css', scss: 'scss', json: 'json',
  sql: 'sql', sh: 'bash', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', md: 'markdown',
};
const langOf = (p: string) => LANGS[(p.split('.').pop() || '').toLowerCase()] || '';

const studio = () => (window as any).studio;

export function CodeStudio({ settings }: { settings: AISettings }) {
  const [projects] = useState<Project[]>(loadProjects());
  const [root, setRoot] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [rightTab, setRightTab] = useState<'agent' | 'terminal' | 'changes'>('agent');
  const [agentMsgs, setAgentMsgs] = useState<AgentMsg[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentInput, setAgentInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const agentId = useRef(0);
  const [termLog, setTermLog] = useState<{ k: 'cmd' | 'out' | 'exit'; t: string }[]>([]);
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const [changedFiles, setChangedFiles] = useState<Map<string, number>>(new Map());
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const collapsedByRoot = useRef<Map<string, Set<string>>>(new Map());
  const [diffTarget, setDiffTarget] = useState<{ path: string; oldText: string; newText: string } | null>(null);
  const [sandboxMode, setSandboxMode] = useState<boolean>(!!settings.agentSandbox);
  const [sandboxPending, setSandboxPending] = useState<{ root: string; files: string[] } | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const agentEndRef = useRef<HTMLDivElement>(null);
  const termEndRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (projects[0] && !root) setRoot(projects[0].path); }, [projects, root]);

  const refreshTree = async () => {
    if (!root) return;
    try {
      const list = await studio().fs.listTree(root, { maxDepth: 15 });
      setTree(list);
    } catch (e: any) { uiAlert(e.message); }
  };
  useEffect(() => { refreshTree(); }, [root]);

  // Eingeklappte Ordner werden pro Projekt-Wurzel gemerkt, damit sie
  // beim Wechsel zwischen Dateien/Ansichten erhalten bleiben.
  useEffect(() => {
    collapsedByRoot.current.set(root, new Set(collapsedDirs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedDirs]);
  useEffect(() => {
    setCollapsedDirs(new Set(collapsedByRoot.current.get(root) || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Flache listTree-Liste (DFS-Preorder) → echter Ordnerbaum.
  // Ordner zuerst, dann alphabetisch — wie in VS Code.
  const treeItems = useMemo(() => {
    const roots: TreeItem[] = [];
    const dirAtDepth: (TreeItem | null)[] = [];
    const cmp = (a: TreeItem, b: TreeItem) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name, 'de') : a.isDir ? -1 : 1;
    for (const n of tree) {
      const node: TreeItem = { ...n, children: [] };
      if (n.depth === 0) roots.push(node);
      else {
        const parent = dirAtDepth[n.depth - 1];
        if (parent) parent.children.push(node);
        else roots.push(node); // Fallback: nie eintreten bei korrekter Preorder
      }
      dirAtDepth[n.depth] = n.isDir ? node : null;
    }
    const sortRec = (nodes: TreeItem[]) => {
      nodes.sort(cmp);
      for (const n of nodes) if (n.isDir) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
  }, [tree]);

  const toggleDir = (path: string) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  // Pfade der Elternordner der offenen Datei — für dezente Markierung.
  const openAncestors = useMemo(() => {
    const s = new Set<string>();
    if (!file || !root) return s;
    let p = file.replace(/^[\\/]+/, '');
    const rootNorm = root.replace(/[\\/]+$/, '');
    while (p.startsWith(rootNorm)) {
      const idx = p.lastIndexOf('/');
      const idx2 = p.lastIndexOf('\\');
      const cut = Math.max(idx, idx2);
      if (cut <= rootNorm.length) break;
      p = p.slice(0, cut);
      if (p !== rootNorm) s.add(p);
    }
    return s;
  }, [file, root]);

  const fileIcon = (name: string) => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) return <FileImage size={14} />;
    if (ext === 'json' || ext === 'jsonc') return <FileJson size={14} />;
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'cs', 'rb', 'php', 'swift', 'kt', 'html', 'css', 'scss', 'sql', 'sh', 'ps1', 'yaml', 'yml'].includes(ext)) return <FileCode2 size={14} />;
    return <FileText size={14} />;
  };

  useEffect(() => {
    const off = studio().term.onChunk((chunk: string) => {
      setTermLog(prev => {
        const last = prev[prev.length - 1];
        if (last && last.k === 'out') return [...prev.slice(0, -1), { ...last, t: last.t + chunk }];
        return [...prev, { k: 'out' as const, t: chunk }];
      });
    });
  }, []);

  useEffect(() => { agentEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [agentMsgs, agentBusy]);
  useEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLog]);

  const openFile = async (n: TreeNode) => {
    if (n.isDir) return;
    try {
      const c = await studio().fs.readFile(n.path, 1_500_000);
      setFile(n.path); setContent(c); setSaved(c);
    } catch (e: any) { uiAlert(e.message); }
  };

  const save = async () => {
    if (!file) return;
    await studio().fs.writeFile(file, content);
    setSaved(content);
  };

  // Klappt den Ordner und alle seine Vorfahren auf, damit neue
  // Dateien auch in tief verschachtelten Pfaden sichtbar werden.
  const expandDirChain = (dirPath: string) => {
    if (!root) return;
    const rootNorm = root.replace(/[\\/]+$/, '');
    setCollapsedDirs(prev => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let p = dirPath;
      while (p.length >= rootNorm.length && p.startsWith(rootNorm)) {
        next.delete(p);
        if (p === rootNorm) break;
        const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        if (cut < 0) break;
        p = p.slice(0, cut);
      }
      return next;
    });
  };

  // Inline-Erstellung (window.prompt wird von Electron nicht unterstützt)
  const [creating, setCreating] = useState<null | { kind: 'file' | 'dir'; value: string }>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const createEntry = async () => {
    if (!creating || !root) return;
    const kind = creating.kind;
    const v = creating.value.trim();
    setCreating(null);
    if (!v) return;
    try {
      if (kind === 'dir') {
        const clean = v.replace(/^[/\\]+|[/\\]+$/g, '');
        if (!clean) return;
        await studio().fs.mkdir(root, clean);
        expandDirChain(root.replace(/[\\/]+$/, '') + '/' + clean);
        refreshTree();
      } else {
        const p = root.replace(/[\\/]+$/, '') + '/' + v;
        const relDir = v.replace(/[\\/][^\\/]+$/, ''); // '' wenn Datei ins Root
        await studio().fs.mkdir(root, relDir);
        await studio().fs.writeFile(p, '// neu\n');
        if (relDir) expandDirChain(root.replace(/[\\/]+$/, '') + '/' + relDir);
        refreshTree();
        openFile({ name: v, path: p, isDir: false, depth: 0 });
      }
    } catch (e: any) { uiAlert(e.message); }
  };

  const delFile = async () => {
    if (!file) return;
    const rel = file.slice(root.length).replace(/^[\\/]/, '');
    if (!(await uiConfirm(`„${rel}“ wirklich löschen? (Backup wird angelegt)`, undefined, true))) return;
    await studio().fs.deletePath(root, rel);
    setFile(null); setContent(''); setSaved('');
    refreshTree();
  };

  // ---------- Agent ----------
  const agentSend = async (preset?: string) => {
    const text = (preset ?? agentInput).trim();
    if (!text || agentBusy || !root) return;
    const myId = ++agentId.current;
    setAgentMsgs(prev => [...prev, { id: myId, kind: 'user', text }]);
    if (!preset) setAgentInput('');
    setAgentBusy(true);

    const proj = projects.find(p => p.path === root);
    const history = agentMsgs
      .filter(m => m.kind === 'user' || m.kind === 'assistant')
      .map(m => ({ role: m.kind === 'user' ? 'user' : 'assistant', content: m.text }));

    // Kontext: aktuell geöffnete Datei
    let msg = text;
    if (file && content) {
      const rel = file.slice(root.length).replace(/^[\\/]/, '');
      msg = `[Der Nutzer hat die Datei „${rel}“ im Editor geöffnet. Aktueller Inhalt:\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\`\n\nAufgabe: ${text}]`;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantAcc = '';
    let assistantId: number | null = null;
    let sandboxRoot: string | undefined;

    const push = (m: AgentMsg) => setAgentMsgs(prev => [...prev, m]);

    const agentResult = await runAgent({
      settings, projectRoot: root, projectName: proj?.name, history, userMessage: msg,
      signal: controller.signal, sandbox: sandboxMode,
      onConfirmCommand: async (cmd) => uiConfirm(`Kritischer Befehl wurde von der KI angefordert:\n\n${cmd}\n\nIm Projektordner ausführen?`, undefined, true),
      onEvent: (e: AgentEvent) => {
        if (e.type === 'token') {
          assistantAcc += e.text || '';
          if (assistantId === null) {
            assistantId = ++agentId.current;
            setAgentMsgs(prev => [...prev, { id: assistantId!, kind: 'assistant', text: assistantAcc }]);
          } else {
            setAgentMsgs(prev => prev.map(m => m.id === assistantId ? { ...m, text: assistantAcc } : m));
          }
        } else if (e.type === 'tool') {
          push({ id: ++agentId.current, kind: 'tool', text: '', tool: e.name, args: e.args, result: e.result, ok: e.ok });
        } else if (e.type === 'filechange') {
          const rel = String(e.text || '');
          setChangedFiles(prev => new Map(prev).set(rel, (prev.get(rel) || 0) + 1));
          refreshTree();
        } else if (e.type === 'verify') {
          push({ id: ++agentId.current, kind: 'verify', text: e.text || '' });
        } else if (e.type === 'error') {
          push({ id: ++agentId.current, kind: 'error', text: e.text || 'Fehler' });
        } else if (e.type === 'sandbox') {
          sandboxRoot = e.text;
          push({ id: ++agentId.current, kind: 'tool', text: '', tool: 'sandbox', args: { mode: 'Testkopie' }, result: `Arbeitskopie: ${e.text}`, ok: true });
        } else if (e.type === 'done') {
          if (!assistantAcc && e.text) {
            assistantId = ++agentId.current;
            setAgentMsgs(prev => [...prev, { id: assistantId!, kind: 'assistant', text: e.text! }]);
          }
        }
      },
    });
    setAgentBusy(false);
    abortRef.current = null;
    // Sandbox-Ergebnis: Änderungen erst nach expliziter Übernahme ins Original
    const sRoot = sandboxRoot || agentResult?.sandboxRoot;
    const sFiles = agentResult?.changedFiles || [];
    if (sRoot && sFiles.length) {
      setSandboxPending({ root: sRoot, files: sFiles });
      push({
        id: ++agentId.current, kind: 'verify',
        text: `**Sandbox-Modus:** ${sFiles.length} Datei(en) in der Arbeitskopie geändert. Das Originalprojekt ist unverändert — Übernahme nur nach deiner Bestätigung (siehe Hinweis oben im Agent-Tab).`,
      });
    } else if (sRoot) {
      await discardSandbox(sRoot); // nichts geändert → Kopie aufräumen
    }
    if (file) { // Editor-Stand aktualisieren falls die offene Datei geändert wurde
      try { const c = await studio().fs.readFile(file, 1_500_000); setContent(c); setSaved(c); } catch {}
    }
  };

  const agentStop = () => abortRef.current?.abort();

  const toggleSandbox = (v: boolean) => {
    setSandboxMode(v);
    (settings as any).agentSandbox = v;
    try { saveSettings(settings); } catch {}
  };

  const applySandbox = async () => {
    if (!sandboxPending || sandboxBusy) return;
    setSandboxBusy(true);
    try {
      const res = await applySandboxChanges(root, sandboxPending.root, sandboxPending.files);
      const msg = [
        res.applied.length ? `Übernommen: ${res.applied.join(', ')}` : 'Keine Änderungen zu übernehmen (Inhalte identisch).',
        res.conflicts.length ? `⚠ KONFLIKT (Original zwischenzeitlich geändert — nicht überschrieben): ${res.conflicts.join(', ')}` : '',
        res.failed.length ? `FEHLER bei: ${res.failed.join(', ')}` : '',
        res.skipped.length ? `unverändert: ${res.skipped.length} Datei(en)` : '',
      ].filter(Boolean).join(' · ');
      setAgentMsgs(prev => [...prev, { id: ++agentId.current, kind: 'verify', text: `**Sandbox-Übernahme:** ${msg}` }]);
      setChangedFiles(new Map(sandboxPending.files.map(f => [f, 1])));
      await discardSandbox(sandboxPending.root);
      setSandboxPending(null);
      refreshTree();
      if (file) { try { const c = await studio().fs.readFile(file, 1_500_000); setContent(c); setSaved(c); } catch {} }
    } finally { setSandboxBusy(false); }
  };

  const dropSandbox = async () => {
    if (!sandboxPending || sandboxBusy) return;
    setSandboxBusy(true);
    try {
      await discardSandbox(sandboxPending.root);
      setAgentMsgs(prev => [...prev, { id: ++agentId.current, kind: 'verify', text: '**Sandbox verworfen** — das Originalprojekt wurde nicht verändert.' }]);
      setSandboxPending(null);
    } finally { setSandboxBusy(false); }
  };

  const showSandboxDiff = async (rel: string) => {
    if (!sandboxPending) return;
    try {
      const oldText = await studio().fs.readFile(root.replace(/[\\/]+$/, '') + '/' + rel, 1_500_000).catch(() => '');
      const newText = await studio().fs.readFile(sandboxPending.root.replace(/[\\/]+$/, '') + '/' + rel, 1_500_000).catch(() => '(in Sandbox nicht vorhanden)');
      setDiffTarget({ path: rel + ' (Sandbox)', oldText, newText });
    } catch (e: any) { uiAlert(e.message); }
  };

  const showDiff = async (rel: string) => {
    const absPath = root.replace(/[\\/]+$/, '') + '/' + rel;
    const newText = await studio().fs.readFile(absPath, 1_500_000).catch(() => '');
    const oldText = (await readBackup(root, rel)) ?? '';
    setDiffTarget({ path: rel, oldText, newText });
  };

  // ---------- Terminal ----------
  const termRunId = useRef<string | null>(null);
  const termStop = async () => {
    if (!termRunId.current) return;
    await studio().term.kill(termRunId.current);
    setTermLog(prev => [...prev, { k: 'exit' as const, t: '[■ Prozess abgebrochen — inkl. Unterprozesse]' }]);
  };

  const termRun = async () => {
    const cmd = termInput.trim();
    if (!cmd || termBusy) return;
    setTermInput('');
    setTermBusy(true);
    const runId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    termRunId.current = runId;
    setTermLog(prev => [...prev, { k: 'cmd' as const, t: cmd }, { k: 'out' as const, t: '● läuft…' }]);
    try {
      const res = await studio().term.run({ cwd: root || undefined, command: cmd, timeoutMs: 300000, runId });
      if (res.killed) {
        setTermLog(prev => [...prev.filter(l => l.t !== '● läuft…'), { k: 'exit' as const, t: '[■ Abgebrochen (exit -1)]' }]);
      } else {
        setTermLog(prev => [...prev.filter(l => l.t !== '● läuft…'),
          ...(res.stdout ? [{ k: 'out' as const, t: res.stdout }] : []),
          ...(res.stderr ? [{ k: 'out' as const, t: '[stderr] ' + res.stderr }] : []),
          { k: 'exit' as const, t: `[exit ${res.code}${res.timedOut ? ' · timeout' : ''}] — bereit` }]);
      }
    } catch (e: any) {
      setTermLog(prev => [...prev.filter(l => l.t !== '● läuft…'), { k: 'out' as const, t: 'Fehler: ' + e.message }]);
    }
    termRunId.current = null;
    setTermBusy(false);
    refreshTree(); // Terminal-Befehle können Dateien/Ordner angelegt oder gelöscht haben
  };

  // ---------- Editor highlight ----------
  const highlighted = useMemo(() => {
    if (!file) return '';
    const lang = langOf(file);
    try {
      return lang ? hljs.highlight(content, { language: lang }).value : hljs.highlightAuto(content).value;
    } catch { return content.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  }, [content, file]);

  const onEditorScroll = () => {
    const ta = taRef.current, pre = hlRef.current;
    if (ta && pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
  };

  const rel = file ? file.slice(root.length).replace(/^[\\/]/, '') : '';

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', padding: 18, gap: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div className="page-title">Coding Studio</div>
          <div className="page-sub" style={{ marginBottom: 0 }}>Agent, Editor und Terminal — die KI arbeitet direkt in deinem Projekt.</div>
        </div>
        <select value={root} onChange={e => setRoot(e.target.value)} style={{ minWidth: 220 }}>
          <option value="">— Projekt wählen —</option>
          {projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={() => { setCreating({ kind: 'file', value: 'src/neue-datei.txt' }); setTimeout(() => createInputRef.current?.focus(), 0); }} disabled={!root} title="Neue Datei"><FilePlus2 size={14} /> Neu</button>
        <button className="btn" onClick={() => { setCreating({ kind: 'dir', value: 'src/neuer-ordner' }); setTimeout(() => createInputRef.current?.focus(), 0); }} disabled={!root} title="Neuer Ordner"><FolderPlus size={14} /> Ordner</button>
        <button className="btn" onClick={delFile} disabled={!file} title="Datei löschen"><Trash2 size={14} /></button>
        <button className="btn" onClick={refreshTree} disabled={!root} title="Baum aktualisieren"><RefreshCw size={14} /></button>
      </div>

      {!root ? (
        <div className="glass-card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty-state">
            <FolderOpen size={40} style={{ margin: '0 auto 14px', opacity: .4 }} />
            Wähle oben ein Projekt oder lege unter „Projekte“ einen Ordner an.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
          {/* Dateibaum — echter hierarchischer Explorer (VS-Code-Stil) */}
          <div className="glass-card fm-tree cs-tree" style={{ width: 280, overflow: 'auto', padding: 8 }}>
            <div className="fm-path" style={{ marginBottom: 8 }}>{root}</div>
            {creating && (
              <div className="cs-create">
                <input
                  ref={createInputRef}
                  value={creating.value}
                  onChange={e => setCreating({ ...creating, value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') createEntry(); if (e.key === 'Escape') setCreating(null); }}
                  placeholder={creating.kind === 'dir' ? 'Ordnername (z. B. src/util)' : 'Dateiname (z. B. src/datei.js)'}
                  spellCheck={false}
                />
                <button className="btn primary" onClick={createEntry} title="Erstellen"><Save size={13} /></button>
                <button className="btn" onClick={() => setCreating(null)} title="Abbrechen"><X size={13} /></button>
              </div>
            )}
            {(() => {
              const renderNodes = (nodes: TreeItem[], depth: number): React.ReactNode =>
                nodes.map(n => {
                  const isOpen = n.isDir && !collapsedDirs.has(n.path);
                  const sel = !n.isDir && file === n.path;
                  const inPath = n.isDir && openAncestors.has(n.path);
                  return (
                    <React.Fragment key={n.path}>
                      <div
                        className={`fi${sel ? ' sel' : ''}${inPath ? ' inpath' : ''}`}
                        style={{ paddingLeft: 6 + depth * 14 }}
                        onClick={() => (n.isDir ? toggleDir(n.path) : openFile(n))}
                        title={n.path}
                      >
                        {n.isDir ? (
                          <ChevronRight size={12} className={`cs-chev${isOpen ? ' open' : ''}`} />
                        ) : (
                          <span className="cs-chev-space" />
                        )}
                        <span className={`cs-ico${n.isDir ? ' dir' : ''}`}>
                          {n.isDir ? (isOpen ? <FolderOpen size={14} /> : <Folder size={14} />) : fileIcon(n.name)}
                        </span>
                        <span className="cs-name">{n.name}</span>
                      </div>
                      {n.isDir && isOpen && renderNodes(n.children, depth + 1)}
                    </React.Fragment>
                  );
                });
              return renderNodes(treeItems, 0);
            })()}
            {treeItems.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-mute)', padding: 10 }}>Keine Dateien</div>}
          </div>

          {/* Editor */}
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: 0, overflow: 'hidden' }}>
            {file ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--glass-edge-soft)', flexShrink: 0 }}>
                  <FileText size={14} style={{ color: 'var(--ink-mute)' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rel}</span>
                  <span style={{ fontSize: 11, color: content === saved ? 'var(--ok)' : 'var(--warn)' }}>{content === saved ? 'Gespeichert' : 'Geändert'}</span>
                  <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={save} disabled={content === saved}><Save size={13} /> Speichern</button>
                </div>
                <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'rgba(5,6,8,.5)' }}>
                  <pre
                    ref={hlRef}
                    aria-hidden
                    style={{
                      position: 'absolute', inset: 0, margin: 0, padding: '16px 18px', overflow: 'hidden',
                      fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.65, color: '#d7dbe2',
                      pointerEvents: 'none', whiteSpace: 'pre', tabSize: 2,
                    }}
                    dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
                  />
                  <textarea
                    ref={taRef}
                    className="editor"
                    style={{
                      position: 'absolute', inset: 0, background: 'transparent', border: 'none',
                      color: 'transparent', caretColor: '#fff', borderRadius: 0,
                    }}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    onScroll={onEditorScroll}
                    onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; setContent(content.slice(0, s) + '  ' + content.slice(t.selectionEnd)); setTimeout(() => { t.selectionStart = t.selectionEnd = s + 2; }); } }}
                    spellCheck={false}
                  />
                </div>
              </>
            ) : (
              <div className="empty-state">Datei aus dem Baum wählen oder vom Agenten erstellen lassen.</div>
            )}
          </div>

          {/* Rechte Leiste */}
          <div className="glass-card" style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-edge-soft)' }}>
              {([['agent', Bot, 'Agent'], ['terminal', TerminalSquare, 'Terminal'], ['changes', GitCompareArrows, `Änderungen${changedFiles.size ? ` (${changedFiles.size})` : ''}`]] as const).map(([id, Icon, label]) => (
                <button
                  key={id}
                  onClick={() => setRightTab(id)}
                  style={{
                    flex: 1, padding: '11px 4px', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font)',
                    background: rightTab === id ? 'rgba(255,255,255,.07)' : 'transparent',
                    color: rightTab === id ? 'var(--ink)' : 'var(--ink-mute)',
                    borderBottom: rightTab === id ? '2px solid rgba(255,255,255,.4)' : '2px solid transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                ><Icon size={14} /> {label}</button>
              ))}
            </div>

            {rightTab === 'agent' && (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                  {agentMsgs.length === 0 && (
                    <div className="empty-state" style={{ padding: 30 }}>
                      <Bot size={34} style={{ margin: '0 auto 12px', opacity: .4 }} />
                      Coding-Agent bereit. Beschreibe eine Aufgabe — die KI liest, schreibt und führt Befehle im Projekt aus.
                      <div style={{ fontSize: 11, marginTop: 10, opacity: .7 }}>Modell: {settings.ollamaModel || '—'} · Provider: Ollama erforderlich</div>
                    </div>
                  )}
                  {agentMsgs.map(m => (
                    <div key={m.id}>
                      {m.kind === 'user' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <div style={{ maxWidth: '90%', padding: '9px 14px', borderRadius: '14px 14px 4px 14px', background: 'rgba(255,255,255,.12)', border: '1px solid var(--glass-edge)', fontSize: 13, lineHeight: 1.55 }}>{m.text}</div>
                        </div>
                      )}
                      {m.kind === 'assistant' && (
                        <div style={{ padding: '10px 14px', borderRadius: '14px 14px 14px 4px', background: 'rgba(255,255,255,.05)', border: '1px solid var(--glass-edge-soft)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                      )}
                      {m.kind === 'tool' && (
                        <details style={{ border: '1px solid var(--glass-edge-soft)', borderRadius: 10, background: 'rgba(255,255,255,.03)', fontSize: 12 }}>
                          <summary style={{ padding: '8px 12px', cursor: 'pointer', color: m.ok === false ? 'var(--danger)' : 'var(--ink-dim)', display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)' }}>{m.tool}</span>
                            <span style={{ opacity: .7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.args?.path || m.args?.command || m.args?.query || ''}</span>
                            <span style={{ color: m.ok === false ? 'var(--danger)' : 'var(--ok)' }}>{m.ok === false ? '✕' : '✓'}</span>
                          </summary>
                          {m.result && <pre style={{ padding: '10px 12px', margin: 0, borderTop: '1px solid var(--glass-edge-soft)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ink-dim)', fontFamily: 'var(--mono)', fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{m.result}</pre>}
                        </details>
                      )}
                      {m.kind === 'verify' && (
                        <div style={{ padding: '11px 14px', borderRadius: '12px', border: '1px solid var(--glass-edge)', background: 'rgba(255,255,255,.04)', fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)' }}>
                          {m.text}
                        </div>
                      )}
                      {m.kind === 'error' && (
                        <div style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(229,83,75,.35)', background: 'rgba(229,83,75,.08)', color: '#f0b1ad', fontSize: 12.5 }}>{m.text}</div>
                      )}
                    </div>
                  ))}
                  {agentBusy && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ink-mute)', fontSize: 12 }}>
                      <span className="typing"><span /><span /><span /></span> Agent arbeitet…
                    </div>
                  )}
                  <div ref={agentEndRef} />
                </div>
                {sandboxPending && (
                  <div className="glass-card" style={{ margin: '10px 12px 0', padding: '10px 13px', borderColor: 'rgba(255,255,255,.18)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Sandbox-Ergebnis: {sandboxPending.files.length} Datei(en) geändert — Original unverändert</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8, fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>{sandboxPending.files.join(', ')}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn primary" style={{ padding: '5px 12px', fontSize: 12 }} disabled={sandboxBusy} onClick={applySandbox}>✓ Übernehmen</button>
                      {sandboxPending.files.map(f => (
                        <button key={f} className="btn" style={{ padding: '5px 10px', fontSize: 11.5 }} onClick={() => showSandboxDiff(f)}>Diff: {f}</button>
                      ))}
                      <button className="btn danger" style={{ padding: '5px 12px', fontSize: 12 }} disabled={sandboxBusy} onClick={dropSandbox}>Verwerfen</button>
                    </div>
                  </div>
                )}
                <div style={{ padding: 12, borderTop: '1px solid var(--glass-edge-soft)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ink-mute)', whiteSpace: 'nowrap', cursor: 'pointer' }} title="Agent arbeitet in einer Projektkopie — Änderungen erst nach Bestätigung übernehmen">
                    <input type="checkbox" checked={sandboxMode} onChange={e => toggleSandbox(e.target.checked)} disabled={agentBusy} /> Sandbox
                  </label>
                  <input
                    type="text" style={{ flex: 1 }} placeholder={agentBusy ? 'Agent läuft…' : 'Aufgabe für den Coding-Agent…'}
                    value={agentInput} onChange={e => setAgentInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && agentSend()}
                    disabled={agentBusy}
                  />
                  <button
                    className="btn" style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}
                    disabled={agentBusy}
                    title="Vollständige Projektanalyse: Sprache, Framework, Struktur, Einstiegspunkt, Abhängigkeiten, Fehler"
                    onClick={() => agentSend('Führe zuerst eine vollständige Projektanalyse durch: erkenne Programmiersprache(n), Framework(s), Projektstruktur, Einstiegspunkt, Konfigurationsdateien, Abhängigkeiten, Datenbanken/APIs falls vorhanden und offensichtliche Fehler oder fehlende Komponenten. Lies dafür relevante Dateien (package.json, requirements.txt, pom.xml, build.gradle, *.sln, go.mod, Cargo.toml usw.). Gib mir dann eine verständliche Übersicht auf Deutsch. Speichere danach die wichtigsten Projekterkenntnisse mit dem remember-Werkzeug, damit du sie dir in späteren Aufgaben merken kannst.')}
                  >Analysieren</button>
                  {agentBusy
                    ? <button className="btn danger" onClick={agentStop} style={{ padding: '8px 12px' }}><Square size={14} /></button>
                    : <button className="btn primary" onClick={() => agentSend()} disabled={!agentInput.trim()} style={{ padding: '8px 12px' }}><SendHorizontal size={14} /></button>}
                </div>
              </>
            )}

            {rightTab === 'terminal' && (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12, fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6, minHeight: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {termLog.length === 0 && <div style={{ color: 'var(--ink-mute)' }}>Terminal bereit — Befehl eingeben und Enter drücken.</div>}
                  {termLog.map((l, i) => (
                    <div key={i} style={{ color: l.k === 'cmd' ? 'var(--ink)' : l.k === 'exit' ? 'var(--ink-mute)' : 'var(--ink-dim)' }}>
                      {l.k === 'cmd' ? '❯ ' + l.t : l.t}
                    </div>
                  ))}
                  <div ref={termEndRef} />
                </div>
                <div style={{ padding: 12, borderTop: '1px solid var(--glass-edge-soft)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--ink-mute)', fontFamily: 'var(--mono)' }}>❯</span>
                  <input
                    type="text" style={{ flex: 1, fontFamily: 'var(--mono)' }} placeholder={termBusy ? 'Prozess läuft… (Strg+C = abbrechen)' : 'Befehl…'}
                    value={termInput} onChange={e => setTermInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); termRun(); }
                      else if (e.ctrlKey && e.key.toLowerCase() === 'c' && termBusy) { e.preventDefault(); termStop(); }
                      else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setTermLog([]); }
                    }}
                  />
                  {termBusy && (
                    <button className="btn danger" onClick={termStop} style={{ padding: '8px 12px', whiteSpace: 'nowrap' }} title="Laufenden Prozess inkl. Unterprozesse beenden (Strg+C)">
                      <Square size={13} /> Stopp
                    </button>
                  )}
                  {!termBusy && termLog.length > 0 && (
                    <button className="btn" onClick={() => setTermLog([])} style={{ padding: '8px 10px' }} title="Terminal leeren (Strg+L)">Leeren</button>
                  )}
                </div>
              </>
            )}

            {rightTab === 'changes' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                {changedFiles.size === 0 ? (
                  <div className="empty-state" style={{ padding: 30 }}>Noch keine Dateiänderungen vom Agenten.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[...changedFiles.keys()].map(p => (
                      <div key={p} className="glass-chip" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px' }}>
                        <FileText size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
                        <button className="btn" style={{ padding: '4px 11px', fontSize: 11.5 }} onClick={() => showDiff(p)}>Diff</button>
                      </div>
                    ))}
                  </div>
                )}
                {diffTarget && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-dim)', fontFamily: 'var(--mono)' }}>{diffTarget.path}</span>
                      <button className="btn" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={() => setDiffTarget(null)}>Schließen</button>
                    </div>
                    {diffTarget.oldText ? (
                      <DiffView oldText={diffTarget.oldText} newText={diffTarget.newText} filePath={diffTarget.path} />
                    ) : (
                      <div className="empty-state" style={{ padding: 20 }}>Kein Backup vorhanden — Datei wurde vermutlich neu erstellt.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
