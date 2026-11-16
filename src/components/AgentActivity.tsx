import React, { useMemo, useState } from 'react';
import { ChevronRight, CheckCircle2, XCircle, CircleDot, FileDiff, ListTree, Search, Terminal, FlaskConical, Globe, Brain, ShieldCheck, Package } from 'lucide-react';
import { DiffView } from './DiffView';

interface Ev { type: string; name?: string; args?: any; result?: string; ok?: boolean; text?: string; path?: string; oldText?: string; newText?: string; ts?: number }

const CAT_META: Record<string, { label: string; desc: string }> = {
  search:    { label: 'Projekt durchsuchen',   desc: 'Dateien und Inhalte wurden durchsucht' },
  analyze:   { label: 'Code analysieren',      desc: 'Dateien wurden gelesen und ausgewertet' },
  edit:      { label: 'Dateien bearbeiten',    desc: 'Änderungen wurden vorbereitet und gespeichert' },
  cmd:       { label: 'Befehle ausführen',     desc: 'Terminalbefehle im Projekt' },
  test:      { label: 'Tests ausführen',       desc: 'Funktionsprüfungen mit erwarteter Ausgabe' },
  research:  { label: 'Recherchieren',         desc: 'Websuche und Dokumentation' },
  verify:    { label: 'Änderungen prüfen',     desc: 'Rücklesen, Syntax- und Funktionstests' },
  system:    { label: 'Agent-Ablauf',          desc: 'Systemmeldungen der Aufgabe' },
};

function categoryOf(e: Ev): string {
  if (e.type === 'filediff' || e.type === 'filechange') return 'edit';
  if (e.type === 'error') return 'system';
  if (e.type === 'verify') return 'verify';
  if (e.type === 'sandbox') return 'system';
  if (e.type === 'done') return 'verify';
  switch (e.name) {
    case 'list_dir': case 'search_files': case 'project_overview': case 'git_status': return 'search';
    case 'read_file': return 'analyze';
    case 'write_file': case 'edit_file': case 'replace_lines': case 'set_json_value': case 'mkdir': case 'rename_path': case 'delete_path': return 'edit';
    case 'run_command': return 'cmd';
    case 'run_test': return 'test';
    case 'remember': case 'recall': return 'system';
    case 'web_search': case 'fetch_url': return 'research';
    default: return 'system';
  }
}

function titleOf(e: Ev): string {
  const hint = e.args?.path || e.args?.command || e.args?.query || e.args?.key || e.args?.url || '';
  switch (e.type) {
    case 'filediff': return `Änderung gespeichert: ${e.path || ''}`;
    case 'filechange': return `Datei geändert: ${e.text || ''}`;
    case 'error': return `Fehler: ${e.text || ''}`;
    case 'verify': return e.text || 'Verifikation';
    case 'sandbox': return `Sandbox: ${e.text || ''}`;
    case 'done': return 'Aufgabe abgeschlossen';
    default: return `${e.name}${hint ? ' — ' + String(hint).slice(0, 90) : ''}`;
  }
}

function catIcon(cat: string) {
  switch (cat) {
    case 'search': return <Search size={13} />;
    case 'analyze': return <ListTree size={13} />;
    case 'edit': return <FileDiff size={13} />;
    case 'cmd': return <Terminal size={13} />;
    case 'test': return <FlaskConical size={13} />;
    case 'research': return <Globe size={13} />;
    case 'verify': return <ShieldCheck size={13} />;
    default: return <CircleDot size={13} />;
  }
}

interface Step { ev: Ev; open: boolean }
interface Group { cat: string; steps: Step[] }

export function AgentActivity({ events }: { events: Ev[] }) {
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState(false);

  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    for (const ev of events) {
      const cat = categoryOf(ev);
      const last = out[out.length - 1];
      if (last && last.cat === cat) last.steps.push({ ev, open: false });
      else out.push({ cat, steps: [{ ev, open: false }] });
    }
    return out;
  }, [events]);

  if (!events.length) return null;
  const total = events.length;
  const failed = events.filter(e => e.ok === false || e.type === 'error').length;

  const toggleAll = () => {
    const next = !allOpen;
    setAllOpen(next);
    setGroupsOpen(Object.fromEntries(groups.map(g => [g.cat + g.steps[0].ev.ts, next])));
  };

  return (
    <div className="agent-activity">
      <div className="aa-head">
        <span className="aa-title"><Brain size={13} /> Agent-Aktivität</span>
        <span className="aa-meta">{total} Schritte{failed ? ` · ${failed} Fehler` : ''}</span>
        <button className="mini-btn" onClick={toggleAll}>{allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}</button>
      </div>
      {groups.map((g, gi) => {
        const meta = CAT_META[g.cat] || CAT_META.system;
        const key = g.cat + (g.steps[0].ev.ts || gi);
        const open = groupsOpen[key] ?? allOpen;
        const gFailed = g.steps.filter(s => s.ev.ok === false || s.ev.type === 'error').length;
        return (
          <div key={gi} className="aa-group">
            <button className="aa-group-head" onClick={() => setGroupsOpen(s => ({ ...s, [key]: !(s[key] ?? allOpen) }))}>
              <ChevronRight size={13} className={`aa-chev ${open ? 'open' : ''}`} />
              <span className="aa-cat-icon">{catIcon(g.cat)}</span>
              <span className="aa-cat-label">{meta.label}</span>
              <span className="aa-cat-desc">{meta.desc}</span>
              <span className="aa-count">{g.steps.length}{gFailed ? ` · ${gFailed}✗` : ''}</span>
            </button>
            {open && (
              <div className="aa-steps">
                {g.steps.map((s, si) => <StepRow key={si} step={s} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(step.open);
  const e = step.ev;
  const failed = e.ok === false || e.type === 'error';
  const hasDetail = !!(e.result || e.args || e.oldText || e.newText || e.type === 'filediff');
  return (
    <div className={`aa-step ${failed ? 'failed' : ''}`}>
      <button className="aa-step-head" onClick={() => hasDetail && setOpen(o => !o)} disabled={!hasDetail}>
        {failed ? <XCircle size={13} className="aa-ico err" /> : e.ok === true || e.type === 'filediff' || e.type === 'done' || e.type === 'verify' ? <CheckCircle2 size={13} className="aa-ico ok" /> : <CircleDot size={13} className="aa-ico run" />}
        <span className="aa-step-title">{titleOf(e)}</span>
        {e.ts && <span className="aa-step-ts">{new Date(e.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
        {hasDetail && <ChevronRight size={12} className={`aa-chev ${open ? 'open' : ''}`} />}
      </button>
      {open && (
        <div className="aa-step-body">
          {e.type === 'filediff' && e.oldText != null && e.newText != null ? (
            <DiffView oldText={e.oldText} newText={e.newText} filePath={e.path} />
          ) : (
            <>
              {e.args && Object.keys(e.args).length > 0 && (
                <pre className="aa-args">{JSON.stringify(e.args, null, 1).slice(0, 3000)}</pre>
              )}
              {e.result && <pre className="aa-result">{String(e.result).slice(0, 8000)}</pre>}
              {e.text && e.type !== 'done' && <pre className="aa-result">{e.text}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
