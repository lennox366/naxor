import React from 'react';
import { Composer } from './Composer';
import { Logo } from './Logo';
import { AISettings, Attachment } from '../types';
import {
  Code2, Palette, Image as ImageIcon, FolderOpen, Presentation,
  FileText, Bot, Sparkles, Cpu, Activity, HardDrive, Clock,
} from 'lucide-react';

interface Props {
  settings: AISettings;
  onSend: (text: string, attachments: Attachment[], mode?: string) => void;
  projects?: { name: string; path: string }[];
  activeProject?: string;
  onProjectChange?: (path: string) => void;
}

const QUICK = [
  { icon: <Code2 />, title: 'Code entwickeln', desc: 'Projekte planen, schreiben und debuggen', prompt: 'Ich möchte ein neues Programmierprojekt starten. Hilf mir, Architektur und Code zu planen.' },
  { icon: <Palette />, title: 'Design erstellen', desc: 'UI-Konzepte, Layouts und Styles', prompt: 'Hilf mir, ein modernes dunkles Glassmorphism-Design für eine Web-App zu entwerfen.' },
  { icon: <ImageIcon />, title: 'Bilder generieren', desc: 'Bildprompts und Generierung', prompt: 'Ich möchte ein Bild generieren. Hilf mir, einen passenden Prompt zu erstellen.' },
  { icon: <FolderOpen />, title: 'Projekt öffnen', desc: 'Codebase analysieren und erweitern', prompt: 'Analysiere mein Projekt und schlage nächste Schritte vor.' },
  { icon: <Presentation />, title: 'Präsentation erstellen', desc: 'Folien, Gliederungen, Speaker Notes', prompt: 'Erstelle eine Präsentationsstruktur zu meinem Thema.' },
  { icon: <FileText />, title: 'Dokument erstellen', desc: 'Berichte, Anleitungen, Konzepte', prompt: 'Hilf mir, ein professionelles Dokument zu erstellen.' },
  { icon: <Bot />, title: 'KI-Agent starten', desc: 'Autonome Aufgaben & Workflows', prompt: 'Starte als KI-Agent und arbeite meine Aufgabe Schritt für Schritt ab.' },
];

export function Dashboard({ settings, onSend, projects, activeProject, onProjectChange }: Props) {
  const cores = (navigator as any).hardwareConcurrency || '—';
  const mem = (navigator as any).deviceMemory ? `${(navigator as any).deviceMemory} GB` : '—';
  const providerLabel = settings.provider === 'ollama' ? 'Lokal' : settings.provider === 'openai' ? 'Cloud' : 'Custom';

  return (
    <div className="view">
      <div className="dash">
        <div className="dash-main">
          <div className="greeting">
            <div className="eyebrow"><Logo size={16} /> NAXORA</div>
            <h1>Willkommen zurück.</h1>
            <p>Dein lokaler KI-Partner für Code, Design, Dokumente und Sprache — mit Streaming und Sprachausgabe.</p>
          </div>
          <div className="quick-grid">
            {QUICK.map(q => (
              <button key={q.title} className="quick-card" onClick={() => onSend(q.prompt, [])}>
                <div className="qi">{q.icon}</div>
                <div className="qt">{q.title}</div>
                <div className="qd">{q.desc}</div>
              </button>
            ))}
          </div>
          <Composer onSend={onSend} settings={settings} placeholder="Frag die KI etwas oder starte ein Projekt…" autoFocus projects={projects} activeProject={activeProject} onProjectChange={onProjectChange} />
        </div>
        <div className="dash-side">
          <div className="info-card">
            <h4><Cpu /> KI-Modell</h4>
            <div className="kv"><span>Provider</span><b>{providerLabel}</b></div>
            <div className="kv"><span>Modell</span><b>{settings.provider === 'ollama' ? settings.ollamaModel : settings.provider === 'openai' ? settings.openaiModel : settings.customModel || '—'}</b></div>
            <div className="kv"><span>Streaming</span><b>aktiv</b></div>
          </div>
          <div className="info-card">
            <h4><Activity /> System</h4>
            <div className="kv"><span>CPU-Kerne</span><b>{cores}</b></div>
            <div className="kv"><span>Speicher</span><b>{mem}</b></div>
            <div className="kv"><span>Speicherort</span><b>SQLite lokal</b></div>
            <div className="bar"><i style={{ width: '62%' }} /></div>
          </div>
          <div className="info-card">
            <h4><Clock /> Sitzung</h4>
            <div className="kv"><span>Start</span><b>{new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</b></div>
            <div className="kv"><span>Sprachausgabe</span><b>{'speechSynthesis' in window ? 'bereit' : '—'}</b></div>
            <div className="kv"><span>Spracheingabe</span><b>{'SpeechRecognition' in window || (window as any).webkitSpeechRecognition ? 'Web Speech' : 'Endpoint'}</b></div>
          </div>
          <div className="info-card">
            <h4><HardDrive /> App</h4>
            <div className="kv"><span>Version</span><b>0.2.0</b></div>
            <div className="kv"><span>Stack</span><b>Electron · React · TS</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}
