import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Message, Attachment, AISettings } from '../types';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { Markdown } from './Markdown';
import { sendChat, ChatMessage } from '../services/ai';
import { speak, stopSpeaking, isSpeaking } from '../services/speech';
import { addMessage, updateMessage, autoTitle } from '../chatStore';
import { query } from '../db';
import { takePendingSend, inflightSends, spokenByChat, subscribeSendState, notifySendState } from '../chatRuntime';
import { startAgentTask, whenAgentTaskDone, agentTasksForChat, abortAgentTask, respondAgentConfirm, subscribeAgentTasks } from '../taskRuntime';
import { uiConfirm, uiAlert } from '../uiDialog';

interface Props {
  chatId: string;
  messages: Message[];
  settings: AISettings;
  onMessagesChanged: () => void;
  onFirstMessage?: () => void;
  voiceModeActive?: boolean;
  onVoiceModeToggle?: (v: boolean) => void;
  projects?: { name: string; path: string }[];
  activeProject?: string;
  onProjectChange?: (path: string) => void;
}

const BASE_PROMPT = 'Du bist 230% Offiziell — ein hilfreicher, präziser KI-Partner für Programmierung, Design, Dokumente und Projekte. Antworte auf Deutsch, sofern der Nutzer nicht anders schreibt. Nutze Markdown mit Codeblöcken wo sinnvoll. Wenn eine Aufgabe das Anlegen oder Ändern von Dateien in einem Projekt erfordert, weise darauf hin, dass der Coding-Agent (Coding Studio → Agent) sie direkt im Projekt ausführen kann.';

// Zentrale Regel: Coding-Aufträge bei offenem Projekt gehen an den Agenten,
// nicht an den reinen Chat. Greift in JEDEM Chat mit aktivem Projekt.
// Coding-Intent: ein Handlungsverb INNERHALB von 40 Zeichen gefolgt von einem
// Coding-Nomen. Verhindert Fehltreffer wie „Wie schreibe ich einen Brief?".
const AGENT_INTENT = /\b(erstelle|programmiere|schreibe|baue|entwickle|implementiere|fixe|repariere|debugge|uebersetze|converte|migriere|optimiere|refaktoriere|analysiere|verbessere|erweitere|ergänze|hinzufüge|entferne|lösche|umbaue|modernisiere|codest|ändere|aendere|suche|finde|ersetze|aktualisiere|konfiguriere|trage|setze|prüfe|untersuche|untersuchen|korrektur|reparatur)\b[\s\S]{0,40}?\b(code|programm|funktion|datei|projekt|app|anwendung|website|webseite|bot|dashboard|api|skript|modul|klasse|system|design|seite|tool|werkzeug|befehl|endpoint|datenbank|test|einstellung|konfiguration|config|variable|parameter|wert|fehler|bug)\b/i;

export function ChatView({ chatId, messages, settings, onMessagesChanged, onFirstMessage, voiceModeActive, onVoiceModeToggle, projects, activeProject, onProjectChange }: Props) {
  // isThinking initial aus der module-level Registry: nach einem
  // Chatwechsel läuft die Anfrage evtl. noch — dann bleibt der
  // Stopp-Button sichtbar statt einen zweiten Sende-Vorgang zu erlauben.
  const [streaming, setStreaming] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(() => inflightSends.has(chatId));
  // Reaktiv: Agent-Aufgaben und Sende-Status aus der Runtime (überlebt Remounts)
  const [, setTaskTick] = useState(0);
  useEffect(() => subscribeAgentTasks(() => setTaskTick((x) => x + 1)), []);
  useEffect(() => subscribeSendState(() => setIsThinking(inflightSends.has(chatId))), [chatId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // ID der Assistentennachricht, deren Antwort DURCH DIESE Instanz
  // abgeschlossen wurde. Verhindert, dass ein Remount mitten im Stream
  // die partielle DB-Antwort vorliest und darüber eine Auto-Sendung
  // im Sprachmodus auslöst.
  const finishedRef = useRef<string | null>(null);
  const voiceModeRef = useRef(false);
  voiceModeRef.current = !!voiceModeActive;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // TTS im alten Chat nicht weiterlaufen lassen — sonst könnte das
      // voiceListen-Event nach dem Wechsel eine Anfrage im falschen Chat
      // auslösen.
      stopSpeaking();
    };
  }, []);

  useEffect(() => { voiceModeRef.current = !!voiceModeActive; }, [voiceModeActive]);

  // autoscroll only if user is near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleSpeak = useCallback((text: string, id: string) => {
    try {
      speak(text, settings, () => setSpeakingId(null), (m) => uiAlert(m));
      setSpeakingId(id);
    } catch (e: any) {
      uiAlert(e.message);
    }
  }, [settings]);

  const handleStopSpeak = useCallback(() => { stopSpeaking(); setSpeakingId(null); }, []);

  // continuous voice mode: speak assistant reply then listen again
  useEffect(() => {
    if (!voiceModeActive || !streaming === false) return;
    if (!mountedRef.current) return;
    const last = messages[messages.length - 1];
    // Nur vorlesen, wenn DIESE Instanz die Antwort gerade abgeschlossen hat
    // (finishedRef).spokenByChat ist zusätzlich chat-gebunden und überlebt
    // Remounts — ein Chatwechsel löst kein erneutes Vorlesen/Anhören aus.
    if (!finishedRef.current || last?.id !== finishedRef.current) return;
    finishedRef.current = null;
    if (last?.role === 'assistant' && last.content && last.content !== spokenByChat.get(chatId)) {
      spokenByChat.set(chatId, last.content);
      try {
        speak(last.content, settings, () => {
          setSpeakingId(null);
          if (mountedRef.current) {
            window.dispatchEvent(new CustomEvent('studio:voiceListen'));
          }
        }, (m) => { setSpeakingId(null); uiAlert(m); });
        setSpeakingId(last.id);
      } catch { /* no TTS */ }
    }
  }, [messages, voiceModeActive, settings, streaming, chatId]);

  const sendRef = useRef<(t: string, a: Attachment[], m?: string) => void>(() => {});
  // Pending-Send (z. B. Dashboard → neuer Chat): fest an diese chatId
  // gebunden und atomar abgeholt. Ein Chatwechsel kann die Nachricht
  // weder erneut senden noch in einen falschen Chat leiten.
  useEffect(() => {
    const p = takePendingSend(chatId);
    if (p) sendRef.current(p.text, p.attachments, p.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const send = async (text: string, attachments: Attachment[], mode?: string) => {
    // Dedup über Modul-Registry: isThinking ist lokaler State und wird
    // bei Chatwechsel/Remount zurückgesetzt — die Registry nicht.
    // So kann eine laufende Anfrage nie durch einen Remount dupliziert
    // werden, und legitime neue Nachrichten (nach Abschluss) bleiben möglich.
    if (inflightSends.has(chatId)) return;
    if (isThinking) return;
    if (!text.trim() && attachments.length === 0) return;

    const isFirst = messages.length === 0;
    if (isFirst) onFirstMessage?.();

    const meta = attachments.length ? { attachments } : undefined;
    const userMsg = addMessage(chatId, 'user', text, meta);
    autoTitle(chatId, text || attachments[0]?.name || 'Chat');
    onMessagesChanged();

    const proj = projects?.find(pr => pr.path === activeProject);
    // Expliziter Coding-Modus ODER erkannter Programmierauftrag → Agent.
    const codingIntent = mode === 'code' || AGENT_INTENT.test(text.trim());
    // Geteiltes, verifiziertes Wissen aus der gemeinsamen Wissensbasis
    // (z. B. bestätigte Testergebnisse/ Reparaturen des Coding-Agenten).
    let sharedKnowledge = '';
    try {
      // Verifiziertes Wissen: global ODER für das aktive Projekt (Scope-Hash)
      // — so finden auch andere Chats desselben Projekts bestätigte Ergebnisse.
      const projHash = proj ? proj.path.replace(/[^a-zA-Z0-9]/g, '_').slice(-40) : null;
      const rows = projHash
        ? query<any>("SELECT title, kind, content FROM knowledge WHERE verified=1 AND (scope='global' OR scope=?) ORDER BY created_at DESC LIMIT 5", [projHash])
        : query<any>("SELECT title, kind, content FROM knowledge WHERE scope='global' AND verified=1 ORDER BY created_at DESC LIMIT 5");
      if (rows.length) {
        sharedKnowledge = '\n\nGeteiltes verifiziertes Wissen (aus früheren, tatsächlich geprüften Läufen):\n' +
          rows.map(r => `- [${r.kind}] ${r.title}: ${String(r.content).slice(0, 300)}`).join('\n');
      }
    } catch { /* DB evtl. nicht bereit */ }
    const sysPrompt = (proj
      ? `${BASE_PROMPT}\nAktives Projekt des Nutzers: „${proj.name}“ unter ${proj.path}. Beziehe dich bei Code-/Projektfragen auf dieses Projekt.`
      : BASE_PROMPT)
      + (codingIntent && !proj ? '\n\nHinweis: Der Nutzer möchte Code erstellt haben, aber es ist KEIN Projekt geöffnet. Erstelle vollständigen, lauffähigen Code direkt in der Antwort. Du kannst keine Dateien anlegen — verweise darauf, dass ein geöffnetes Projekt für Dateiänderungen nötig ist.' : '')
      + sharedKnowledge;

    // build context
    const history: ChatMessage[] = [
      { role: 'system', content: sysPrompt },
      ...messages.slice(-30).map(m => ({ role: m.role as any, content: m.content })),
      { role: 'user', content: text || '(Datei-Anhang)' },
    ];

    // assistant placeholder
    const aMsg = addMessage(chatId, 'assistant', '');
    setIsThinking(true);
    setStreaming('');
    onMessagesChanged();

    const controller = new AbortController();
    abortRef.current = controller;
    inflightSends.set(chatId, controller);
    notifySendState();
    let acc = '';
    try {
      // Coding-Auftrag → Coding-Agent. Ohne geöffnetes Projekt wird ein
      // sicherer Ablauf angeboten: Ordner wählen → als Projekt registrieren →
      // Agent arbeitet darin (nie ohne Bestätigung).
      let agentRoot = proj?.path;
      let agentName = proj?.name;
      if (!agentRoot && codingIntent) {
        if (await uiConfirm('Kein Projekt ist ausgewählt. Soll ein Projektordner gewählt und der Coding-Agent darin arbeiten?', undefined, true)) {
          try {
            const dir = await (window as any).studio?.fs?.pickFolder?.();
            if (dir) {
              const { loadSettings, saveSettings } = await import('../services/ai');
              const s = loadSettings() as any;
              const list = s.projects || [];
              const name = String(dir).split(/[\\/]/).filter(Boolean).pop() || dir;
              if (!list.find((x: any) => x.path === dir)) {
                list.push({ name, path: dir });
                s.projects = list;
                saveSettings(s);
              }
              agentRoot = dir;
              agentName = name;
            }
          } catch { /* Ordnerwahl fehlgeschlagen → normaler Chat */ }
        }
      }
      if (agentRoot && codingIntent) {
        const agentLog: string[] = [];
        const agentEvents: any[] = [];
        const msgMeta = () => {
          const base = aMsg.meta ? (() => { try { return JSON.parse(aMsg.meta!); } catch { return {}; } })() : {};
          if (agentEvents.length) base.agentEvents = agentEvents;
          return base;
        };
        const render = () => updateMessage(aMsg.id, acc + (agentLog.length ? '\n\n' + agentLog.join('\n') : ''), msgMeta());
        // Aufgabe startet in der zentralen Runtime — läuft unabhängig
        // davon, ob diese ChatView gemountet bleibt. Bestätigungen kommen
        // als pendingConfirm in der Chat-UI (siehe unten), nicht als
        // blockierender nativer Dialog.
        const task = startAgentTask({
          chatId, projectRoot: agentRoot, projectName: agentName,
          prompt: text, settings, sandbox: !!settings.agentSandbox,
          history: messages.slice(-12).map(m => ({ role: m.role as any, content: String(m.content || '').slice(0, 1500) })),
          onEvent: (e) => {
            if (e.type === 'token') { acc += e.text || ''; setStreaming(acc); render(); }
            else if (e.type !== 'confirm') {
              // Strukturierte Schritte für die Live-Arbeitsanzeige sammeln
              const slim = { ...e };
              if (e.type !== 'filediff') { delete slim.oldText; delete slim.newText; }
              agentEvents.push({ ...slim, ts: e.ts || Date.now() });
            }
            if (e.type === 'tool' && e.result !== undefined) {
              const hint = e.args?.path || e.args?.command || e.args?.query || '';
              const res = String(e.result || '').replace(/\s+/g, ' ').slice(0, 90);
              agentLog.push(`*[Agent › ${e.name}${hint ? ' ' + String(hint).slice(0, 80) : ''}]* ${e.ok === false ? '✗' : '✓'} ${res}`);
              render();
            }
            else if (e.type === 'filechange') { agentLog.push(`*[Datei: ${e.text}]*`); render(); }
            else if (e.type === 'sandbox') { agentLog.push(`*[Sandbox]* Arbeitskopie: ${e.text}`); render(); }
            else if (e.type === 'error') { agentLog.push(`*Agent-Fehler: ${e.text}*`); render(); }
            else if (e.type === 'done') { acc = e.text || acc; setStreaming(acc); render(); }
          },
        });
        // Auf Completion warten — die Runtime übernimmt Bestätigungen und
        // Sandbox-Anwendung; das Ergebnis bleibt in der DB-Nachricht.
        const doneTask = await whenAgentTaskDone(task.id);
        const finalText = doneTask?.result || (acc + (agentLog.length ? '\n\n' + agentLog.join('\n') : ''));
        if (finalText.trim()) {
          acc = finalText;
          setStreaming(acc);
          updateMessage(aMsg.id, acc);
        } else if (agentLog.length) {
          acc = agentLog.join('\n');
          setStreaming(acc);
          updateMessage(aMsg.id, acc);
        }
      } else {
      // Provider „local“: Router stellt passendes Modell bereit —
      // Coding-Aufträge ohne Projekt nutzen die Code-Rolle für bessere Qualität
      const effSettings = settings.provider === 'local'
        ? await (await import('../llm')).effectiveSettings(settings, codingIntent ? 'code' : 'chat')
        : settings;
      await sendChat(effSettings, history, (tok) => {
        acc += tok;
        setStreaming(acc);
        updateMessage(aMsg.id, acc);
      }, controller.signal);
      }
      setIsThinking(false);
      setStreaming(null);
      finishedRef.current = aMsg.id; // adoptiert: diese Instanz hat geantwortet
      onMessagesChanged();
      // voice mode: speak the reply — nur wenn diese ChatView noch
      // gemountet ist, sonst könnte das voiceListen-Event im falschen
      // Chat eine neue Sprachanfrage auslösen.
      if (mountedRef.current && voiceModeRef.current && acc) {
        try {
          spokenByChat.set(chatId, acc); // Effect darf nicht erneut vorlesen
          speak(acc, settings, () => {
            if (mountedRef.current) {
              window.dispatchEvent(new CustomEvent('studio:voiceListen'));
            }
          }, (m) => { setSpeakingId(null); uiAlert(m); });
          setSpeakingId(aMsg.id);
        } catch {}
      }
    } catch (e: any) {
      setIsThinking(false);
      setStreaming(null);
      const errText = e.name === 'AbortError' ? '*(Antwort abgebrochen)*' : `*Fehler: ${e.message}*`;
      updateMessage(aMsg.id, errText);
      onMessagesChanged();
    } finally {
      inflightSends.delete(chatId);
      notifySendState();
      abortRef.current = null;
    }
  };

  const stop = () => {
    // Registry hat Vorrang: funktioniert auch, wenn die ChatView seit dem
    // Senden neu gemountet wurde (abortRef ist dann leer).
    (inflightSends.get(chatId) || abortRef.current)?.abort();
    // Laufende Agent-Aufgaben dieses Chats ebenfalls abbrechen
    for (const t of agentTasksForChat(chatId)) {
      if (['wartend', 'warteschlange', 'lauft', 'bestaetigung'].includes(t.status)) abortAgentTask(t.id);
    }
  };
  sendRef.current = send;

  return (
    <div className="chat-wrap" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-inner">
          {messages.filter(m => m.content).map(m => (
            <MessageBubble
              key={m.id}
              msg={m}
              onSpeak={handleSpeak}
              speakingId={speakingId === m.id ? m.id : null}
              onStopSpeak={handleStopSpeak}
            />
          ))}
          {streaming !== null && streaming === '' && isThinking && (
            <div className="msg assistant">
              <div className="avatar">AI</div>
              <div className="body"><div className="bubble"><div className="typing"><span/><span/><span/></div></div></div>
            </div>
          )}
          {isThinking && streaming && (
            <div className="msg assistant">
              <div className="avatar">AI</div>
              <div className="body"><div className="bubble"><Markdown text={streaming} /></div></div>
            </div>
          )}
        </div>
      </div>
      {isThinking && (
        <div style={{ position: 'absolute', top: 14, right: 30 }}>
          <button className="btn danger" style={{ padding: '5px 14px', fontSize: 12 }} onClick={stop}>■ Stopp</button>
        </div>
      )}
      {/* Ausstehende Agent-Bestätigung — erscheint in diesem Chat,
          auch wenn die Aufgabe im Hintergrund gestartet wurde */}
      {(() => {
        const pt = agentTasksForChat(chatId).find((t) => t.pendingConfirm);
        if (!pt?.pendingConfirm) return null;
        const pc = pt.pendingConfirm;
        return (
          <div className="agent-confirm">
            <div className="agent-confirm-title">
              {pc.kind === 'command' ? '🔐 Der Coding-Agent möchte einen Befehl ausführen' : '📦 Sandbox-Ergebnis bereit'}
            </div>
            <div className="agent-confirm-body">
              {pc.kind === 'command'
                ? <code>{pc.command}</code>
                : <span>{pc.files?.length ?? 0} Datei(en) geändert{pc.projectName ? ` in „${pc.projectName}“` : ''} — Übernahme in das Originalprojekt?</span>}
            </div>
            {pc.kind === 'sandbox' && pc.files && pc.files.length > 0 && (
              <div className="agent-confirm-files">{pc.files.slice(0, 8).join(', ')}{pc.files.length > 8 ? ' …' : ''}</div>
            )}
            <div className="agent-confirm-actions">
              <button className="btn primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => respondAgentConfirm(pt.id, true)}>
                {pc.kind === 'command' ? 'Erlauben' : 'Übernehmen'}
              </button>
              <button className="btn" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => respondAgentConfirm(pt.id, false)}>
                {pc.kind === 'command' ? 'Ablehnen' : 'Verwerfen'}
              </button>
            </div>
          </div>
        );
      })()}
      {speakingId && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
          <span className="speaking-indicator">
            <span className="bars"><i/><i/><i/><i/></span> KI spricht…
            <button className="mini-btn" onClick={handleStopSpeak}>Stopp</button>
          </span>
        </div>
      )}
      <Composer
        onSend={send}
        disabled={false}
        settings={settings}
        placeholder="Nachricht an die KI…"
        voiceModeActive={voiceModeActive}
        onVoiceModeToggle={onVoiceModeToggle}
        projects={projects}
        activeProject={activeProject}
        onProjectChange={onProjectChange}
      />
    </div>
  );
}
