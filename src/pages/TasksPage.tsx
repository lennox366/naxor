import React, { useEffect, useState } from 'react';
import {
  getAgentTasks, subscribeAgentTasks, abortAgentTask, respondAgentConfirm,
  type AgentTask, type TaskStatus,
} from '../taskRuntime';
import { listChats } from '../chatStore';
import { Markdown } from '../components/Markdown';
import {
  ListChecks, Play, Clock, CheckCircle2, XCircle, Ban, PauseCircle,
  ShieldQuestion, ExternalLink, Square, CircleDot,
} from 'lucide-react';

interface Props {
  onOpenChat: (chatId: string) => void;
}

type Filter = 'alle' | 'laufend' | 'warteschlange' | 'bestaetigung'
  | 'erfolgreich' | 'fehlgeschlagen' | 'abgebrochen' | 'unterbrochen';

const STATUS_META: Record<TaskStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  wartend: { label: 'Wartend', icon: <Clock size={13} />, cls: 'st-wait' },
  warteschlange: { label: 'Warteschlange', icon: <Clock size={13} />, cls: 'st-wait' },
  lauft: { label: 'Läuft', icon: <Play size={13} />, cls: 'st-run' },
  bestaetigung: { label: 'Bestätigung nötig', icon: <ShieldQuestion size={13} />, cls: 'st-confirm' },
  erfolgreich: { label: 'Erfolgreich', icon: <CheckCircle2 size={13} />, cls: 'st-ok' },
  fehlgeschlagen: { label: 'Fehlgeschlagen', icon: <XCircle size={13} />, cls: 'st-fail' },
  abgebrochen: { label: 'Abgebrochen', icon: <Ban size={13} />, cls: 'st-abort' },
  unterbrochen: { label: 'Unterbrochen', icon: <PauseCircle size={13} />, cls: 'st-wait' },
};

const ACTIVE: TaskStatus[] = ['wartend', 'warteschlange', 'lauft', 'bestaetigung'];

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'laufend', label: 'Laufend' },
  { id: 'warteschlange', label: 'Warteschlange' },
  { id: 'bestaetigung', label: 'Bestätigung' },
  { id: 'erfolgreich', label: 'Erfolgreich' },
  { id: 'fehlgeschlagen', label: 'Fehlgeschlagen' },
  { id: 'abgebrochen', label: 'Abgebrochen' },
  { id: 'unterbrochen', label: 'Unterbrochen' },
];

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(t: AgentTask): string {
  const end = t.finishedAt || Date.now();
  const s = Math.max(0, Math.round((end - t.createdAt) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function TasksPage({ onOpenChat }: Props) {
  const [, setTick] = useState(0);
  const [filter, setFilter] = useState<Filter>('alle');
  const [selId, setSelId] = useState<string | null>(null);

  useEffect(() => subscribeAgentTasks(() => setTick((x) => x + 1)), []);

  const tasks = getAgentTasks(); // bei jedem tick-Render frisch
  const chatTitles = (() => {
    const m = new Map<string, string>();
    for (const c of listChats()) m.set(c.id, c.title);
    return m;
  })();

  const pending = tasks.filter((t) => t.pendingConfirm);
  const filtered = tasks.filter((t) => {
    if (filter === 'alle') return true;
    if (filter === 'laufend') return ['wartend', 'lauft'].includes(t.status);
    if (filter === 'warteschlange') return t.status === 'warteschlange';
    if (filter === 'bestaetigung') return t.status === 'bestaetigung' || !!t.pendingConfirm;
    return t.status === filter;
  });

  const sel = tasks.find((t) => t.id === selId) || null;
  const lastActivity = (t: AgentTask) => {
    const lines = (t.log || '').split('\n').filter(Boolean);
    return lines.length ? lines[lines.length - 1].slice(0, 110) : (t.prompt || '').slice(0, 110);
  };

  return (
    <div className="page tasks-page">
      <div className="page-head">
        <h1><ListChecks size={20} /> Agent-Aufgaben</h1>
        <p className="page-sub">Alle Coding-Aufgaben aus allen Chats — laufen unabhängig vom geöffneten Chat weiter.</p>
      </div>

      {/* Ausstehende Bestätigungen — immer sichtbar, auch ohne Detailansicht */}
      {pending.map((t) => (
        <div key={t.id} className="agent-confirm" style={{ margin: '0 0 12px' }}>
          <div className="agent-confirm-title">⚠ Bestätigung erforderlich — {chatTitles.get(t.chatId) || 'Chat'}</div>
          <div className="agent-confirm-body">
            {t.pendingConfirm!.kind === 'command'
              ? <code>{t.pendingConfirm!.command}</code>
              : <span>{t.pendingConfirm!.files?.length ?? 0} Datei(en) in Sandbox geändert — Übernahme in das Projekt?</span>}
          </div>
          <div className="agent-confirm-actions">
            <button className="btn primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => respondAgentConfirm(t.id, true)}>
              {t.pendingConfirm!.kind === 'command' ? 'Erlauben' : 'Übernehmen'}
            </button>
            <button className="btn" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => respondAgentConfirm(t.id, false)}>
              {t.pendingConfirm!.kind === 'command' ? 'Ablehnen' : 'Verwerfen'}
            </button>
            <button className="btn" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => { setSelId(t.id); onOpenChat(t.chatId); }}>
              <ExternalLink size={12} /> Zum Chat
            </button>
          </div>
        </div>
      ))}

      {/* Filter */}
      <div className="task-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      <div className="tasks-layout">
        {/* Liste */}
        <div className="tasks-list">
          {filtered.length === 0 && (
            <div className="tasks-empty">Keine Aufgaben in dieser Ansicht.</div>
          )}
          {filtered.map((t) => {
            const meta = STATUS_META[t.status];
            const active = ACTIVE.includes(t.status);
            return (
              <button key={t.id} className={`task-row ${selId === t.id ? 'sel' : ''}`} onClick={() => setSelId(t.id)}>
                <span className={`task-status ${meta.cls}`}>{meta.icon} {meta.label}</span>
                <span className="task-main">
                  <span className="task-prompt" title={t.prompt}>{t.prompt || '(ohne Text)'}</span>
                  <span className="task-meta">
                    {chatTitles.get(t.chatId) || 'Unbekannter Chat'} · {t.projectName || t.projectRoot}
                  </span>
                  <span className="task-activity">{lastActivity(t)}</span>
                </span>
                <span className="task-right">
                  <span className="task-time">{fmtTime(t.createdAt)}</span>
                  <span className="task-dur">{fmtDur(t)}</span>
                  {active && (
                    <span
                      className="task-abort"
                      title="Aufgabe abbrechen"
                      onClick={(e) => { e.stopPropagation(); abortAgentTask(t.id); }}
                    ><Square size={12} /></span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="task-detail">
          {!sel && <div className="tasks-empty">Wähle eine Aufgabe aus, um Log, Ergebnis und Details zu sehen.</div>}
          {sel && (
            <>
              <div className="task-detail-head">
                <div>
                  <div className="task-detail-title">{sel.prompt || '(ohne Text)'}</div>
                  <div className="task-meta">
                    Chat: {chatTitles.get(sel.chatId) || sel.chatId} · Projekt: {sel.projectName || sel.projectRoot}
                  </div>
                  <div className="task-meta">
                    Gestartet: {fmtTime(sel.createdAt)} · Dauer: {fmtDur(sel)} · Status: {STATUS_META[sel.status].label}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => onOpenChat(sel.chatId)}>
                    <ExternalLink size={13} /> Chat öffnen
                  </button>
                  {ACTIVE.includes(sel.status) && (
                    <button className="btn danger" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => abortAgentTask(sel.id)}>
                      <Square size={13} /> Abbrechen
                    </button>
                  )}
                </div>
              </div>

              {sel.pendingConfirm && (
                <div className="agent-confirm" style={{ margin: '10px 0' }}>
                  <div className="agent-confirm-title">
                    {sel.pendingConfirm.kind === 'command' ? '🔐 Befehl ausführen?' : '📦 Sandbox übernehmen?'}
                  </div>
                  <div className="agent-confirm-body">
                    {sel.pendingConfirm.kind === 'command'
                      ? <code>{sel.pendingConfirm.command}</code>
                      : <span>{sel.pendingConfirm.files?.length ?? 0} Datei(en): {(sel.pendingConfirm.files || []).slice(0, 10).join(', ')}</span>}
                  </div>
                  <div className="agent-confirm-actions">
                    <button className="btn primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => respondAgentConfirm(sel.id, true)}>
                      {sel.pendingConfirm.kind === 'command' ? 'Erlauben' : 'Übernehmen'}
                    </button>
                    <button className="btn" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => respondAgentConfirm(sel.id, false)}>
                      {sel.pendingConfirm.kind === 'command' ? 'Ablehnen' : 'Verwerfen'}
                    </button>
                  </div>
                </div>
              )}

              <div className="task-detail-section">
                <div className="task-detail-label"><CircleDot size={12} /> Aktivitäts-Log</div>
                <pre className="task-log">{sel.log || '(noch keine Aktivität)'}</pre>
              </div>

              {sel.result && (
                <div className="task-detail-section">
                  <div className="task-detail-label">Ergebnis</div>
                  <div className="task-result"><Markdown text={sel.result} /></div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
