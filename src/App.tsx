import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Chat, Message, Attachment, AISettings, defaultSettings } from './types';
import { initDB } from './db';
import { listChats, getMessages, createChat } from './chatStore';
import { loadSettings, saveSettings, checkOllama, listOllamaModels } from './services/ai';
import { takePendingDesign } from './designHandoff';
import { loadProjects } from './pages/ProjectsPage';
import { setPendingSend } from './chatRuntime';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ChatView } from './components/ChatView';
import { TopBar } from './components/TopBar';
import { BackgroundFX } from './components/BackgroundFX';
import { Logo } from './components/Logo';
import { ChatsPage } from './pages/ChatsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CodeStudio } from './pages/CodeStudio';
import { DesignStudio } from './pages/DesignStudio';
import { ImageGen } from './pages/ImageGen';
import { Presentations } from './pages/Presentations';
import { Documents } from './pages/Documents';
import { FileManager } from './pages/FileManager';
import { TasksPage } from './pages/TasksPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [pendingDesign, setPendingDesign] = useState<{ html: string; name: string } | null>(null);

  // Chat → Design Studio Übergabe (HTML-Designs aus KI-Antworten)
  useEffect(() => {
    const h = () => {
      const p = takePendingDesign();
      if (p) { setPendingDesign(p); setView('designstudio'); }
    };
    window.addEventListener('studio:openDesign', h);
    return () => window.removeEventListener('studio:openDesign', h);
  }, []);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<AISettings>(defaultSettings);
  const [voiceMode, setVoiceMode] = useState(false);
  const [filesInitialPath, setFilesInitialPath] = useState<string | undefined>();
  const [maximized, setMaximized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('naxora.sidebar') !== '0'; } catch { return true; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(o => {
      const n = !o;
      try { localStorage.setItem('naxora.sidebar', n ? '1' : '0'); } catch { /* ignorieren */ }
      return n;
    });
  }, []);

  // Strg/Cmd + B klappt die Seitenleiste ein/aus
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [toggleSidebar]);

  // Hover-Spotlight: Mausposition als CSS-Variablen an Karten/Buttons (für Leucht-Effekt)
  useEffect(() => {
    const SEL = '.quick-card, .info-card, .glass-card, .task-row, .nav-item, .chat-item, .btn, .model-chip, .composer';
    const h = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(SEL) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', h, { passive: true });
    return () => window.removeEventListener('pointermove', h);
  }, []);
  const [bootError, setBootError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ name: string; path: string }[]>([]);
  const [activeProject, setActiveProject] = useState<string>('');

  useEffect(() => {
    initDB().then(async () => {
      const s = loadSettings();
      // Auto-Repair: fehlt das konfigurierte Ollama-Modell, wähle ein installiertes
      if (s.provider === 'ollama') {
        try {
          const st = await checkOllama(s.ollamaUrl);
          if (st.ok) {
            const models = await listOllamaModels(s.ollamaUrl);
            const names = models.map(m => m.name);
            const current = names.find(n => n === s.ollamaModel || n.startsWith(s.ollamaModel + ':') || s.ollamaModel.startsWith(n + ':'));
            if (!current && names.length > 0) {
              // bevorzuge Coding-Modelle
              const pick = names.find(n => /cod|qwen|deepseek|starcoder|codestral/i.test(n)) || names[0];
              s.ollamaModel = pick;
              saveSettings(s);
            } else if (current && current !== s.ollamaModel) {
              s.ollamaModel = current;
              saveSettings(s);
            }
          }
        } catch { /* Ollama offline — Settings zeigen Status */ }
      }
      setSettings(s);
      setProjects(loadProjects());
      setActiveProject((s as any).activeProject || ''); // Projektwahl wiederherstellen
      // Agent-Aufgaben: Historie laden + verwaiste „laufend“-Status korrigieren
      // (beim Neustart sind alle Hintergrundprozesse beendet)
      try {
        const tr = await import('./taskRuntime');
        tr.hydrateAgentTasks();
        tr.markInterruptedAgentTasks();
      } catch { /* Task-Runtime optional */ }
      refreshChats();
      setReady(true);
    }).catch((e) => {
      console.error('DB-Initialisierung fehlgeschlagen:', e);
      setBootError(`Datenbank konnte nicht initialisiert werden: ${e?.message || e}. Mögliche Ursache: zu wenig freier Festplattenspeicher.`);
    });
    const st = window.speechSynthesis;
    if (st) { st.onvoiceschanged = () => {}; st.getVoices(); }
  }, []);

  useEffect(() => {
    (window as any).studio?.win.isMaximized().then(setMaximized);
  }, []);

  const refreshChats = useCallback(() => setChats(listChats()), []);

  // Ref statt State-Closure: async send()-Aufrufe aus einem nicht mehr
  // gemounteten ChatView rufen onMessagesChanged auf — die Auffrischung
  // muss IMMER den aktuell sichtbaren Chat lesen, nicht den zum
  // Render-Zeitpunkt geschlossenen.
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;

  const refreshMessages = useCallback(() => {
    const id = activeChatIdRef.current;
    setMessages(id ? getMessages(id) : []);
  }, []);

  useEffect(() => { refreshMessages(); }, [activeChatId, refreshMessages]);

  const openChat = (id: string) => {
    setActiveChatId(id);
    setView('chat');
  };

  const newChat = () => {
    setActiveChatId(null);
    setView('dashboard');
  };

  const dashboardSend = (text: string, attachments: Attachment[], mode?: string) => {
    const chat = createChat('Neuer Chat');
    // Pending-Send ist fest an die neue chatId gebunden und wird vom
    // ChatView genau einmal atomar abgeholt — ein Chatwechsel kann die
    // Nachricht weder erneut senden noch in einen falschen Chat leiten.
    setPendingSend(chat.id, text, attachments, mode);
    setActiveChatId(chat.id);
    setView('chat');
    refreshChats();
  };

  const changeSettings = (s: AISettings) => {
    setSettings(s);
    saveSettings(s);
  };

  const changeProject = (path: string) => {
    setActiveProject(path);
    const s = loadSettings() as any;
    s.activeProject = path;
    saveSettings(s);
  };

  if (bootError) {
    return (
      <div className="app">
        <div className="app-bg"><BackgroundFX /></div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ maxWidth: 480, padding: 32, border: '1px solid var(--glass-edge)', borderRadius: 16, background: 'var(--glass-md)', backdropFilter: 'blur(20px)' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Start fehlgeschlagen</h2>
            <p style={{ color: 'var(--ink-dim)', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>{bootError}</p>
            <p style={{ color: 'var(--ink-mute)', fontSize: 12 }}>Prüfe freien Festplattenspeicher und starte die App erneut.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="app">
        <div className="app-bg"><BackgroundFX /></div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <Logo size={56} className="boot-logo" />
            <span style={{ letterSpacing: '.2em', fontSize: 11, textTransform: 'uppercase' }}>NAXORA wird gestartet…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-bg"><BackgroundFX /></div>
      <TopBar
        chats={chats}
        settings={settings}
        onOpenChat={openChat}
        onNavigate={setView}
        onSettingsChange={changeSettings}
        maximized={maximized}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onMaximizeToggle={async () => {
          await (window as any).studio.win.maximize();
          setMaximized(m => !m);
        }}
      />
      <div className="layout">
        <Sidebar
          collapsed={!sidebarOpen}
          view={view}
          setView={setView}
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={openChat}
          onNewChat={newChat}
          onChatsChanged={refreshChats}
        />
        <main className="main">
          {view === 'dashboard' && (
            <Dashboard settings={settings} onSend={dashboardSend} projects={projects} activeProject={activeProject} onProjectChange={changeProject} />
          )}
          {view === 'chat' && activeChatId && (
            <ChatView
              key={activeChatId}
              chatId={activeChatId}
              messages={messages}
              settings={settings}
              onMessagesChanged={refreshMessages}
              voiceModeActive={voiceMode}
              onVoiceModeToggle={setVoiceMode}
              projects={projects}
              activeProject={activeProject}
              onProjectChange={changeProject}
            />
          )}
          {view === 'chat' && !activeChatId && (
            <Dashboard settings={settings} onSend={dashboardSend} projects={projects} activeProject={activeProject} onProjectChange={changeProject} />
          )}
          {view === 'chats' && (
            <ChatsPage refreshKey={chats.length} onOpen={openChat} onChanged={refreshChats} />
          )}
          {view === 'projects' && (
            <ProjectsPage onOpenFiles={(p) => { setFilesInitialPath(p); setView('files'); }} />
          )}
          {view === 'codestudio' && <CodeStudio settings={settings} />}
          {view === 'designstudio' && <DesignStudio settings={settings} pendingDesign={pendingDesign} onPendingConsumed={() => setPendingDesign(null)} />}
          {view === 'imagegen' && <ImageGen settings={settings} />}
          {view === 'presentations' && <Presentations settings={settings} />}
          {view === 'documents' && <Documents settings={settings} />}
          {view === 'files' && <FileManager initialPath={filesInitialPath} />}
          {view === 'tasks' && <TasksPage onOpenChat={openChat} />}
          {view === 'settings' && <SettingsPage settings={settings} onChange={changeSettings} />}
        </main>
      </div>
    </div>
  );
}
