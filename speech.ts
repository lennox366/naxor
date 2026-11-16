import { AISettings } from '../types';

// ---------- TTS ----------
export function getVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis?.getVoices() || [];
}

export function pickVoice(settings: AISettings): SpeechSynthesisVoice | null {
  const voices = getVoices();
  if (settings.voiceURI) {
    const v = voices.find(v => v.voiceURI === settings.voiceURI);
    if (v) return v;
  }
  const de = voices.filter(v => v.lang?.toLowerCase().startsWith('de'));
  return de[0] || voices.find(v => v.lang?.startsWith('en')) || voices[0] || null;
}

export const DEFAULT_ELEVEN_VOICE_ID = 'lzfdHZ2QD3sqy4zwTwi2';

let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentAudio: HTMLAudioElement | null = null;

function cleanSpeakText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' Codeblock. ').replace(/[#*`\[\]()>_-]/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
}

/** ElevenLabs-Cloud-Stimme über den Electron-Hauptprozess (API-Key verlässt die App nur dorthin). */
async function speakElevenLabs(text: string, settings: AISettings, onEnd?: () => void, onError?: (m: string) => void): Promise<void> {
  const tts = (window as any).studio?.tts;
  if (!tts?.elevenlabs) throw new Error('ElevenLabs-Schnittstelle nicht verfügbar (App-Neustart erforderlich).');
  const res = await tts.elevenlabs({
    text,
    apiKey: settings.elevenKey,
    voiceId: settings.elevenVoiceId || DEFAULT_ELEVEN_VOICE_ID,
  });
  if (!res?.ok) throw new Error(res?.error || 'ElevenLabs-Fehler ohne Details.');
  const bytes = Uint8Array.from(atob(res.audioBase64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: res.contentType || 'audio/mpeg' });
  const audio = new Audio(URL.createObjectURL(blob));
  audio.volume = Math.min(1, Math.max(0, settings.ttsVolume ?? 1));
  currentAudio = audio;
  const done = () => { if (currentAudio === audio) currentAudio = null; URL.revokeObjectURL(audio.src); onEnd?.(); };
  audio.onended = done;
  audio.onerror = () => { if (currentAudio === audio) currentAudio = null; onError?.('Audiowiedergabe fehlgeschlagen.'); onEnd?.(); };
  try {
    await audio.play();
  } catch (e: any) {
    if (currentAudio === audio) currentAudio = null;
    onError?.(`Wiedergabe fehlgeschlagen: ${e?.message || e}`);
    onEnd?.();
  }
}

export function speak(text: string, settings: AISettings, onEnd?: () => void, onError?: (m: string) => void): void {
  stopSpeaking();
  if (settings.ttsEngine === 'elevenlabs') {
    const clean = cleanSpeakText(text);
    if (!settings.elevenKey) {
      onError?.('Kein ElevenLabs API-Key konfiguriert — Einstellungen → Sprache → API-Key eintragen.');
      onEnd?.();
      return;
    }
    speakElevenLabs(clean, settings, onEnd, onError).catch(e => {
      onError?.(e?.message || String(e));
      onEnd?.();
    });
    return;
  }
  if (!window.speechSynthesis) { onError?.('Sprachausgabe wird von diesem System nicht unterstützt.'); onEnd?.(); return; }
  const clean = cleanSpeakText(text);
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice(settings);
  if (v) u.voice = v;
  u.rate = settings.voiceRate;
  u.pitch = settings.voicePitch;
  u.volume = Math.min(1, Math.max(0, settings.ttsVolume ?? 1));
  u.lang = v?.lang || 'de-DE';
  u.onend = () => { currentUtterance = null; onEnd?.(); };
  u.onerror = () => { currentUtterance = null; onEnd?.(); };
  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
  currentUtterance = null;
  try { currentAudio?.pause(); } catch {}
  currentAudio = null;
}

export function isSpeaking(): boolean {
  return !!(window.speechSynthesis?.speaking || (currentAudio && !currentAudio.paused && !currentAudio.ended));
}

// ---------- STT ----------
export interface SttResult { text: string; final: boolean }
export type SttHandle = { stop: () => void; abort?: () => void };

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export function sttSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** Web Speech API STT (requires Chromium speech service; may be unavailable in Electron). */
export function startWebSpeechStt(
  lang: string,
  onResult: (r: SttResult) => void,
  onError: (msg: string) => void,
  onEnd: () => void
): SttHandle | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (e: any) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    if (final) onResult({ text: final, final: true });
    else if (interim) onResult({ text: interim, final: false });
  };
  rec.onerror = (e: any) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onError('Mikrofonzugriff verweigert oder Spracherkennung nicht verfügbar.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') onError(`Spracherkennung: ${e.error}`);
  };
  rec.onend = () => onEnd();
  try { rec.start(); } catch (e: any) { onError(e.message); return null; }
  return { stop: () => { try { rec.stop(); } catch {} } };
}

/** Whisper-style STT via OpenAI-compatible /audio/transcriptions endpoint. */
export async function transcribeAudio(
  settings: AISettings, blob: Blob, onError: (m: string) => void
): Promise<string> {
  if (!settings.sttEndpoint) throw new Error('Kein STT-Endpunkt konfiguriert (Einstellungen → Sprache).');
  const fd = new FormData();
  fd.append('file', blob, 'audio.webm');
  fd.append('model', 'whisper-1');
  const res = await fetch(settings.sttEndpoint, {
    method: 'POST',
    headers: settings.sttKey ? { Authorization: `Bearer ${settings.sttKey}` } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(`Transkription fehlgeschlagen: ${res.status}`);
  const j = await res.json();
  return j.text || '';
}

export function recordAudio(onStop: (blob: Blob) => void, onError: (m: string) => void): () => void {
  let stream: MediaStream | null = null;
  let mr: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
    stream = s;
    mr = new MediaRecorder(s, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
    chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream?.getTracks().forEach(t => t.stop());
      onStop(new Blob(chunks, { type: 'audio/webm' }));
    };
    mr.start();
  }).catch(e => onError(`Mikrofonzugriff fehlgeschlagen: ${e.message}`));

  return () => { try { mr?.stop(); } catch {} stream?.getTracks().forEach(t => t.stop()); };
}
