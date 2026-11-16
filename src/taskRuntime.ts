// Zentrale Runtime für Coding-Agent-Aufgaben — unabhängig von React-Komponenten.
// Aufgaben laufen im Hintergrund weiter, wenn der Nutzer den Chat wechselt.
// Status + Log werden in der DB persistiert (agent_tasks-Tabelle).
import { runAgent, applySandboxChanges, discardSandbox, type AgentResult } from './agent';
import { query, run, uid } from './db';
import type { AISettings } from './types';

export type TaskStatus =
  | 'wartend' | 'warteschlange' | 'lauft' | 'bestaetigung'
  | 'erfolgreich' | 'fehlgeschlagen' | 'abgebrochen' | 'unterbrochen';

export interface PendingConfirm {
  kind: 'command' | 'sandbox';
  command?: string;
  files?: string[];
  projectName?: string;
}

export interface AgentTask {
  id: string;
  chatId: string;
  projectRoot: string;
  projectName?: string;
  prompt: string;
  status: TaskStatus;
  /** Aktivitäts-Log (eine Zeile pro Werkzeug-/Datei-Ereignis). */
  log: string;
  /** Fortlaufender Antworttext des Agenten inkl. Aktivitätszeilen. */
  result: string;
  pendingConfirm?: PendingConfirm | null;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export interface StartTaskOpts {
  chatId: string;
  projectRoot: string;
  projectName?: string;
  prompt: string;
  settings: AISettings;
  history: { role: string; content: string }[];
  sandbox: boolean;
  /** Live-Ereignisse für die UI (Token/Tool/etc.) — zusätzlich zum Task-Log. */
  onEvent?: (e: any) => void;
}

const ACTIVE: TaskStatus[] = ['wartend', 'warteschlange', 'lauft', 'bestaetigung'];

const tasks = new Map<string, AgentTask>();
const taskOpts = new Map<string, StartTaskOpts>();
const controllers = new Map<string, AbortController>();
const confirmWaiters = new Map<string, (ok: boolean) => void>();
const projectQueues = new Map<string, string[]>(); // projectRoot → wartende Task-IDs
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
  schedulePersist();
}

export function subscribeAgentTasks(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getAgentTasks(): AgentTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getAgentTask(id: string): AgentTask | undefined {
  return tasks.get(id);
}

export function agentTasksForChat(chatId: string): AgentTask[] {
  return getAgentTasks().filter((t) => t.chatId === chatId);
}

export function activeTaskForChat(chatId: string): AgentTask | undefined {
  return agentTasksForChat(chatId).find((t) => ACTIVE.includes(t.status));
}

/** Test/Hydration: lädt bestehende Aufgaben aus der DB in den Speicher. */
export function hydrateAgentTasks(): void {
  try {
    const rows = query<any>('SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 200');
    for (const r of rows) {
      if (tasks.has(r.id)) continue;
      tasks.set(r.id, {
        id: r.id, chatId: r.chat_id, projectRoot: r.project_root,
        projectName: r.project_name || undefined, prompt: r.prompt || '',
        status: r.status as TaskStatus, log: r.log || '', result: r.result || '',
        pendingConfirm: r.pending_confirm ? JSON.parse(r.pending_confirm) : null,
        createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at || undefined,
      });
    }
  } catch { /* DB noch nicht bereit */ }
}

/** Beim App-Start: keine verwaisten „laufend“-Aufgaben — Prozesse sind tot. */
export function markInterruptedAgentTasks(): void {
  try {
    run(`UPDATE agent_tasks SET status='unterbrochen', updated_at=? WHERE status IN ('wartend','warteschlange','lauft','bestaetigung')`, [Date.now()]);
    for (const t of tasks.values()) {
      if (ACTIVE.includes(t.status)) { t.status = 'unterbrochen'; t.updatedAt = Date.now(); }
    }
    emit();
  } catch { /* ignore */ }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    for (const t of tasks.values()) persistTask(t);
  }, 600);
}

function persistTask(t: AgentTask) {
  try {
    run(
      `INSERT OR REPLACE INTO agent_tasks
       (id, chat_id, project_root, project_name, prompt, status, log, result, pending_confirm, created_at, updated_at, finished_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.chatId, t.projectRoot, t.projectName || '', t.prompt, t.status,
       (t.log || '').slice(-20000), (t.result || '').slice(-50000),
       t.pendingConfirm ? JSON.stringify(t.pendingConfirm) : null,
       t.createdAt, t.updatedAt, t.finishedAt || null]
    );
  } catch { /* DB nicht bereit — In-Memory-State bleibt */ }
}

function touch(t: AgentTask) {
  t.updatedAt = Date.now();
  emit();
}

function appendLog(t: AgentTask, line: string) {
  t.log = (t.log ? t.log + '\n' : '') + line;
  if (t.log.length > 30000) t.log = t.log.slice(-30000);
}

/** Antwortet auf eine pendingConfirm-Anfrage (aus der Chat-UI). */
export function respondAgentConfirm(taskId: string, approved: boolean): void {
  const waiter = confirmWaiters.get(taskId);
  if (!waiter) return;
  confirmWaiters.delete(taskId);
  const t = tasks.get(taskId);
  if (t) { t.pendingConfirm = null; if (t.status === 'bestaetigung') t.status = 'lauft'; touch(t); }
  waiter(approved);
}

/** Bricht eine Aufgabe ausdrücklich ab — nur diese, keine anderen. */
export function abortAgentTask(taskId: string): void {
  const t = tasks.get(taskId);
  if (!t || !ACTIVE.includes(t.status)) return;
  controllers.get(taskId)?.abort();
  const waiter = confirmWaiters.get(taskId);
  if (waiter) { confirmWaiters.delete(taskId); waiter(false); }
  // Aus der Projekt-Warteschlange entfernen (falls noch nicht gestartet)
  const q = projectQueues.get(t.projectRoot);
  if (q) {
    const i = q.indexOf(taskId);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) projectQueues.delete(t.projectRoot);
  }
  if (t.status === 'warteschlange') {
    // Noch nicht gestartet — sofort als abgebrochen markieren
    t.status = 'abgebrochen';
    t.finishedAt = Date.now();
    appendLog(t, '*(Vom Nutzer abgebrochen — vor Start)*');
    touch(t);
    persistTask(t);
    dequeueProject(t.projectRoot);
    return;
  }
  // Laufende Aufgabe: abort() signalisiert runAgent; Status wird im finally gesetzt
  appendLog(t, '*(Abbruch angefordert)*');
  touch(t);
}

function dequeueProject(projectRoot: string) {
  const q = projectQueues.get(projectRoot);
  if (!q || !q.length) return;
  while (q.length) {
    const nextId = q.shift()!;
    const next = tasks.get(nextId);
    const opts = taskOpts.get(nextId);
    if (next && opts && next.status === 'warteschlange') {
      projectQueues.set(projectRoot, q);
      if (!q.length) projectQueues.delete(projectRoot);
      next.status = 'wartend';
      touch(next);
      void executeTask(next, opts);
      return;
    }
    if (!q.length) projectQueues.delete(projectRoot);
  }
}

function hasActiveTaskForProject(projectRoot: string, excludeId?: string): boolean {
  for (const t of tasks.values()) {
    if (t.id === excludeId) continue;
    if (t.projectRoot === projectRoot && ACTIVE.includes(t.status)) return true;
  }
  return false;
}

/**
 * Startet eine Coding-Aufgabe im Hintergrund. Läuft unabhängig davon,
 * welche ChatView gerade gemountet ist. Pro Projekt läuft immer nur
 * eine Aufgabe — weitere werden in eine Warteschlange gestellt.
 */
export function startAgentTask(opts: StartTaskOpts): AgentTask {
  const now = Date.now();
  const task: AgentTask = {
    id: uid(), chatId: opts.chatId, projectRoot: opts.projectRoot,
    projectName: opts.projectName, prompt: opts.prompt,
    status: 'wartend', log: '', result: '',
    createdAt: now, updatedAt: now,
  };
  tasks.set(task.id, task);
  taskOpts.set(task.id, opts);
  persistTask(task);
  emit();

  if (hasActiveTaskForProject(opts.projectRoot, task.id)) {
    task.status = 'warteschlange';
    const q = projectQueues.get(opts.projectRoot) || [];
    q.push(task.id);
    projectQueues.set(opts.projectRoot, q);
    touch(task);
    return task;
  }
  void executeTask(task, opts);
  return task;
}

/** Promise, das sich löst, wenn die Aufgabe terminal ist. */
export function whenAgentTaskDone(taskId: string): Promise<AgentTask | undefined> {
  return new Promise((resolve) => {
    const check = () => {
      const t = tasks.get(taskId);
      if (!t || !ACTIVE.includes(t.status)) { unsubscribe(); resolve(t); return true; }
      return false;
    };
    if (check()) return;
    const unsubscribe = subscribeAgentTasks(() => { if (check()) unsubscribe(); });
  });
}

function waitForConfirm(task: AgentTask, pc: PendingConfirm): Promise<boolean> {
  return new Promise((resolve) => {
    task.pendingConfirm = pc;
    task.status = 'bestaetigung';
    touch(task);
    confirmWaiters.set(task.id, (ok) => {
      task.pendingConfirm = null;
      if (task.status === 'bestaetigung') task.status = 'lauft';
      touch(task);
      resolve(ok);
    });
  });
}

async function executeTask(task: AgentTask, opts: StartTaskOpts): Promise<void> {
  const controller = new AbortController();
  controllers.set(task.id, controller);
  task.status = 'lauft';
  touch(task);

  const displayLines: string[] = [];
  let acc = '';
  const refreshResult = () => {
    task.result = acc + (displayLines.length ? '\n\n' + displayLines.join('\n') : '');
  };
  const line = (l: string) => { displayLines.push(l); appendLog(task, l); refreshResult(); };

  try {
    const result = await runAgent({
      settings: opts.settings,
      projectRoot: opts.projectRoot,
      projectName: opts.projectName,
      history: opts.history,
      userMessage: opts.prompt,
      signal: controller.signal,
      sandbox: opts.sandbox,
      onConfirmCommand: async (cmd) => {
        const ok = await waitForConfirm(task, { kind: 'command', command: cmd });
        line(ok ? `*[Bestätigung]* Befehl erlaubt: ${cmd.slice(0, 120)}` : `*[Bestätigung]* Befehl abgelehnt: ${cmd.slice(0, 120)}`);
        touch(task);
        return ok;
      },
      onEvent: (e) => {
        opts.onEvent?.(e);
        // Strukturierte Ereignisse dauerhaft persistieren (ohne Token-Stream)
        if (e && e.type !== 'token' && e.type !== 'confirm') {
          try {
            run('INSERT INTO agent_events (task_id, chat_id, ts, kind, payload) VALUES (?,?,?,?,?)',
              [task.id, task.chatId, e.ts || Date.now(), String(e.type || 'event'), JSON.stringify(e).slice(0, 200_000)]);
          } catch { /* Persistenz darf den Agenten nicht stoppen */ }
        }
        if (e.type === 'token') { acc += e.text || ''; task.result = acc + (displayLines.length ? '\n\n' + displayLines.join('\n') : ''); }
        else if (e.type === 'tool' && e.result !== undefined) {
          const hint = e.args?.path || e.args?.command || e.args?.query || e.args?.key || '';
          const res = String(e.result || '').replace(/\s+/g, ' ').slice(0, 90);
          line(`*[Agent › ${e.name}${hint ? ' ' + String(hint).slice(0, 80) : ''}]* ${e.ok === false ? '✗' : '✓'} ${res}`);
        } else if (e.type === 'filechange') {
          line(`*[Datei: ${e.text}]*`);
        } else if (e.type === 'sandbox') {
          line(`*[Sandbox]* Arbeitskopie: ${e.text}`);
        } else if (e.type === 'error') {
          line(`*Agent- Fehler: ${e.text}*`);
        } else if (e.type === 'done') {
          acc = e.text || acc;
          refreshResult();
        }
        touch(task);
      },
    });

    // Sandbox: Übernahme erst nach expliziter Bestätigung in der Chat-UI
    const sRoot = result.sandboxRoot;
    const sFiles = result.changedFiles || [];
    if (sRoot && sFiles.length) {
      const take = await waitForConfirm(task, {
        kind: 'sandbox', files: sFiles.slice(0, 50), projectName: opts.projectName,
      });
      if (take) {
        const res = await applySandboxChanges(opts.projectRoot, sRoot, sFiles);
        line(`*[Sandbox]* Übernommen: ${res.applied.join(', ') || 'keine'}${res.conflicts.length ? ` — KONFLIKT (Original extern geändert): ${res.conflicts.join(', ')}` : ''}${res.failed.length ? ` — FEHLER: ${res.failed.join(', ')}` : ''}`);
      } else {
        await discardSandbox(sRoot);
        line('*[Sandbox]* Verworfen — Original unverändert.*');
      }
    } else if (sRoot) {
      await discardSandbox(sRoot);
    }

    // Status aus dem echten Ergebnis + Werkzeug-Nachweis ableiten —
    // nie aus Modellprosa. unverifiedClaim: Änderung verlangt, aber kein
    // Schreibzugriff wurde rückgelesen → fehlgeschlagen.
    const reportFailed = /Fehlgeschlagen|ABGEBROCHEN|Abgebrochen|NICHT verifiziert/i.test(task.result || '');
    const unverified = !!(result as any)?.unverifiedClaim;
    // Code-Änderungen ohne bestandenen Funktionstest sind NICHT verifiziert —
    // Syntax-Check allein reicht nicht (Runtime-Fehler bleiben unsichtbar).
    const changedFiles: string[] = (result as any)?.changedFiles || [];
    const noFuncTest = changedFiles.length > 0
      && /Nicht ausgeführt|Kein Funktionstest protokolliert/.test(task.result || '')
      && !/Funktionstest bestanden|Testbefehl\(e\) erfolgreich/.test(task.result || '');
    if (unverified) line('*[Nachweis]* Keine verifizierte Dateiänderung — Aufgabe gilt als fehlgeschlagen.*');
    if (noFuncTest) line('*[Nachweis]* Dateien geändert, aber kein Funktionstest bestanden — Aufgabe gilt als fehlgeschlagen.*');
    task.status = controller.signal.aborted ? 'abgebrochen'
      : (reportFailed || unverified || noFuncTest) ? 'fehlgeschlagen' : 'erfolgreich';
  } catch (e: any) {
    line(`*Agent-Fehler: ${e?.message || e}*`);
    task.status = controller.signal.aborted ? 'abgebrochen' : 'fehlgeschlagen';
  } finally {
    if (ACTIVE.includes(task.status)) {
      task.status = controller.signal.aborted ? 'abgebrochen' : 'fehlgeschlagen';
    }
    task.finishedAt = Date.now();
    controllers.delete(task.id);
    confirmWaiters.delete(task.id);
    taskOpts.delete(task.id);
    touch(task);
    persistTask(task);
    dequeueProject(task.projectRoot);
  }
}
