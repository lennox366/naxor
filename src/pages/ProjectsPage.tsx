import React, { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../services/ai';
import { FolderKanban, FolderOpen, Trash2 } from 'lucide-react';
import { AISettings } from '../types';

interface Project { name: string; path: string }

export function loadProjects(): Project[] {
  const s = loadSettings() as any;
  return s.projects || [];
}

export function ProjectsPage({ onOpenFiles }: { onOpenFiles: (path: string) => void }) {
  const [projects, setProjects] = useState<Project[]>(loadProjects);

  const refresh = () => setProjects(loadProjects());

  const addProject = async () => {
    const p = await (window as any).studio.fs.pickFolder();
    if (!p) return;
    const name = p.split(/[\\/]/).pop() || p;
    const s = loadSettings() as any;
    const list: Project[] = s.projects || [];
    if (!list.find(x => x.path === p)) {
      list.push({ name, path: p });
      (s as any).projects = list;
      saveSettings(s);
    }
    refresh();
  };

  const remove = (path: string) => {
    const s = loadSettings() as any;
    s.projects = (s.projects || []).filter((x: Project) => x.path !== path);
    saveSettings(s);
    refresh();
  };

  return (
    <div className="view narrow">
      <div className="page-title">Projekte</div>
      <div className="page-sub">Lokale Projektordner für Coding Studio, Dateiverwaltung und KI-Kontext.</div>
      <div style={{ marginBottom: 16 }}>
        <button className="btn primary" onClick={addProject}>+ Ordner hinzufügen</button>
      </div>
      {projects.length === 0 ? (
        <div className="empty-state">Noch keine Projekte. Füge einen lokalen Ordner hinzu.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {projects.map(p => (
            <div key={p.path} className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div className="qi" style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.07)', border: '1px solid var(--glass-edge-soft)' }}>
                <FolderKanban size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', fontFamily: 'var(--mono)' }}>{p.path}</div>
              </div>
              <button className="btn" onClick={() => onOpenFiles(p.path)}><FolderOpen size={14} /> Öffnen</button>
              <button className="btn" onClick={() => (window as any).studio.app.revealPath(p.path)}>Im Explorer</button>
              <button className="btn danger" onClick={() => remove(p.path)}><Trash2 size={14} /> Entfernen</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
