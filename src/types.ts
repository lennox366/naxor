export type Role = 'user' | 'assistant' | 'system';

export interface Chat {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  mode?: string;
}

export interface Message {
  id: string;
  chat_id: string;
  role: Role;
  content: string;
  created_at: number;
  meta?: string; // JSON: attachments, model, etc.
}

export interface Attachment {
  name: string;
  path?: string;
  mime?: string;
  dataUrl?: string;
  size?: number;
}

export type View =
  | 'dashboard'
  | 'chat'
  | 'chats'
  | 'projects'
  | 'codestudio'
  | 'designstudio'
  | 'imagegen'
  | 'presentations'
  | 'documents'
  | 'files'
  | 'tasks'
  | 'settings';

export interface AISettings {
  provider: 'ollama' | 'openai' | 'custom' | 'local';
  roleModels?: { chat?: string; code?: string; vision?: string; design?: string };
  mmprojPath?: string;
  ollamaUrl: string;
  ollamaModel: string;
  openaiKey: string;
  openaiModel: string;
  customUrl: string;
  customKey: string;
  customModel: string;
  sttEndpoint: string; // OpenAI-compatible /audio/transcriptions
  sttKey: string;
  /** TTS-Engine: 'system' = Windows/Web-Speech, 'elevenlabs' = ElevenLabs Cloud, 'edge' = Microsoft Edge Online (kostenlos), 'clone' = lokale Stimmklon-Engine (noch nicht verfügbar). */
  ttsEngine: 'system' | 'elevenlabs' | 'edge' | 'clone';
  /** Edge-TTS Stimme (z. B. de-DE-KatjaNeural). */
  edgeVoice: string;
  /** Pfad zur Stimmreferenz-MP3 für die lokale Clone-Engine. */
  cloneRefPath: string;
  /** ElevenLabs API-Key (xi-api-key). Wird nur im Electron-Hauptprozess verwendet. */
  elevenKey: string;
  /** ElevenLabs Voice-ID. Standard: die 230%-Offiziell-Stimme. */
  elevenVoiceId: string;
  /** Lautstärke 0–1 für beide Engines. */
  ttsVolume: number;
  /** Automatisch Antworten vorlesen (Chat + Sprachmodus). */
  autoSpeak: boolean;
  /** Ausgewähltes Mikrofon (deviceId aus enumerateDevices, '' = Standard). */
  micDeviceId: string;
  /** Optionaler OpenAI-kompatibler Bild-Endpoint (leer = Pollinations, kostenlos). */
  imageEndpoint: string;
  imageKey: string;
  imageModel: string;
  voiceURI: string;
  voiceRate: number;
  voicePitch: number;
  continuousVoice: boolean;
  /** Sandbox-Modus: Agent arbeitet in einer Projektkopie, Übernahme nur nach Bestätigung. */
  agentSandbox?: boolean;
}

export const defaultSettings: AISettings = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  customUrl: '',
  customKey: '',
  customModel: '',
  sttEndpoint: '',
  sttKey: '',
  ttsEngine: 'system',
  edgeVoice: 'de-DE-KatjaNeural',
  cloneRefPath: '',
  elevenKey: '',
  elevenVoiceId: 'lzfdHZ2QD3sqy4zwTwi2',
  ttsVolume: 1.0,
  autoSpeak: false,
  micDeviceId: '',
  imageEndpoint: '',
  imageKey: '',
  imageModel: '',
  voiceURI: '',
  voiceRate: 1.0,
  voicePitch: 1.0,
  continuousVoice: false,
};
