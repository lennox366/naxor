import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Attachment, AISettings } from '../types';
import { sttSupported, startWebSpeechStt, recordAudio, transcribeAudio, stopSpeaking, SttHandle } from '../services/speech';
import { Paperclip, Image as ImageIcon, Mic, Square, SendHorizontal, FolderOpen, AudioLines } from 'lucide-react';

interface Props {
  onSend: (text: string, attachments: Attachment[], mode?: string) => void;
  disabled?: boolean;
  settings: AISettings;
  placeholder?: string;
  autoFocus?: boolean;
  onVoiceModeToggle?: (active: boolean) => void;
  voiceModeActive?: boolean;
  projects?: { name: string; path: string }[];
  activeProject?: string;
  onProjectChange?: (path: string) => void;
}

export function Composer({ onSend, disabled, settings, placeholder, autoFocus, onVoiceModeToggle, voiceModeActive, projects = [], activeProject, onProjectChange }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'chat' | 'code' | 'design'>('chat');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sttActive, setSttActive] = useState(false);
  const [interim, setInterim] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sttRef = useRef<SttHandle | null>(null);
  const stopRecRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const voiceModeRef = useRef(!!voiceModeActive);
  voiceModeRef.current = !!voiceModeActive;
  const recordingRef = useRef(false);
  const micRef = useRef<(() => void) | null>(null);

  // Sprachmodus: nach TTS-Ende wieder zuhören
  useEffect(() => {
    const handler = () => {
      if (voiceModeRef.current && !recordingRef.current) {
        setTimeout(() => micRef.current?.(), 300);
      }
    };
    window.addEventListener('studio:voiceListen', handler);
    return () => window.removeEventListener('studio:voiceListen', handler);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  }, [text]);

  useEffect(() => () => { sttRef.current?.stop(); stopRecRef.current?.(); }, []);

  const submit = useCallback(() => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || disabled) return;
    onSend(t, attachments, mode);
    setText('');
    setAttachments([]);
    setInterim('');
  }, [text, attachments, disabled, onSend, mode]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // isComposing: Enter während IME-Eingabemethode nicht als Senden werten
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  const addFiles = async (files: FileList | null, forceImage = false) => {
    if (!files) return;
    const out: Attachment[] = [];
    for (const f of Array.from(files)) {
      const isImg = f.type.startsWith('image/');
      if (forceImage && !isImg) continue;
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(f);
      });
      out.push({ name: f.name, mime: f.type, size: f.size, dataUrl });
    }
    setAttachments(prev => [...prev, ...out]);
  };

  const toggleMic = async () => {
    if (recordingRef.current) { stopAll(); return; }
    if (transcribing) return;
    stopSpeaking(); // TTS unterbrechen, wenn der Nutzer spricht

    if (sttSupported()) {
      setSttActive(true);
      const h = startWebSpeechStt(
        'de-DE',
        (r) => {
          if (r.final) {
            const t = r.text.trim();
            if (voiceModeRef.current && t) {
              setText(''); setInterim('');
              onSend(t, [], mode);
              setTimeout(() => { sttRef.current?.stop(); recordingRef.current = false; setRecording(false); }, 400);
            } else {
              setText(prev => (prev ? prev + ' ' : '') + t);
              setInterim('');
            }
          } else setInterim(r.text);
        },
        (msg) => {
          setSttActive(false);
          if (settings.sttEndpoint) startRecordingFallback();
          else toastErr(msg);
        },
        () => { /* läuft weiter bis Stopp */ }
      );
      if (h) { sttRef.current = h; setRecording(true); recordingRef.current = true; }
      else if (settings.sttEndpoint) startRecordingFallback();
      else toastErr('Spracherkennung nicht verfügbar. Bitte STT-Endpunkt in den Einstellungen konfigurieren.');
    } else if (settings.sttEndpoint) {
      startRecordingFallback();
    } else {
      toastErr('Spracherkennung in dieser Umgebung nicht verfügbar. Konfiguriere einen Whisper-Endpunkt in den Einstellungen.');
    }
  };

  const startRecordingFallback = () => {
    setRecording(true); recordingRef.current = true;
    setTranscribing(true);
    stopRecRef.current = recordAudio(async (blob) => {
      setTranscribing(false); setRecording(false); recordingRef.current = false;
      try {
        const t = await transcribeAudio(settings, blob, toastErr);
        if (t) {
          if (voiceModeRef.current) { setText(''); onSend(t.trim(), [], mode); }
          else setText(prev => (prev ? prev + ' ' : '') + t.trim());
        }
      } catch (e: any) { toastErr(e.message); }
    }, (m) => { setRecording(false); recordingRef.current = false; setTranscribing(false); toastErr(m); }, settings.micDeviceId || '');
  };

  const stopAll = () => {
    sttRef.current?.stop(); sttRef.current = null;
    stopRecRef.current?.(); stopRecRef.current = null;
    setRecording(false); recordingRef.current = false; setSttActive(false); setTranscribing(false); setInterim('');
  };
  micRef.current = toggleMic;

  return (
    <div className="composer-wrap">
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a, i) => (
              <span key={i} className="attach-chip">
                {a.mime?.startsWith('image/') && a.dataUrl ? <img src={a.dataUrl} alt="" /> : <Paperclip size={12} />}
                <span>{a.name}</span>
                <button className="rm" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}><Square size={9} fill="currentColor" /></button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={text + (interim ? (text ? ' ' : '') + interim : '')}
          onChange={(e) => { setText(e.target.value); setInterim(''); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Nachricht an die KI…'}
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <div className="row">
          <input ref={fileRef} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={imgRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files, true); e.target.value = ''; }} />
          <button className="icon-btn" title="Datei anhängen" onClick={() => fileRef.current?.click()} disabled={disabled}><Paperclip /></button>
          <button className="icon-btn" title="Bild anhängen" onClick={() => imgRef.current?.click()} disabled={disabled}><ImageIcon /></button>
          <button
            className={`icon-btn ${recording ? 'recording' : ''}`}
            title={recording ? 'Aufnahme stoppen' : 'Spracheingabe'}
            onClick={toggleMic}
            disabled={disabled || transcribing}
          >{transcribing ? <Square size={13} /> : recording ? <Square size={13} fill="currentColor" /> : <Mic />}</button>
          {onVoiceModeToggle && (
            <button
              className={`icon-btn ${voiceModeActive ? 'active' : ''}`}
              title="Sprachmodus (Sprechen & Zuhören)"
              onClick={() => onVoiceModeToggle(!voiceModeActive)}
            ><AudioLines /></button>
          )}
          {onProjectChange && projects.length > 0 && (
            <select
              className="project-select"
              title="Projekt-Kontext"
              value={activeProject || ''}
              onChange={e => onProjectChange(e.target.value)}
            >
              <option value="">Kein Projekt</option>
              {projects.map(pr => <option key={pr.path} value={pr.path}>{pr.name}</option>)}
            </select>
          )}
          <div className="spacer" />
          <select
            className="mode-select"
            title={mode === 'code' ? 'Coding-Modus: Die KI arbeitet direkt am ausgewählten Projekt (Dateien, Befehle, Tests)' : 'Modus'}
            value={mode}
            onChange={e => setMode(e.target.value as any)}
          >
            <option value="chat">Chat</option>
            <option value="code">Coding</option>
            <option value="design">Design</option>
          </select>
          <button className="send-btn" onClick={submit} disabled={disabled || (!text.trim() && attachments.length === 0)} title="Senden (Enter)"><SendHorizontal /></button>
        </div>
      </div>
    </div>
  );
}

function toastErr(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast err';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
