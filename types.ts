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
  /** TTS-Engine: 'system' = Windows/Web-Speech, 'elevenlabs' = ElevenLabs Cloud-Stimme. */
  ttsEngine: 'system' | 'elevenlabs';
  /** ElevenLabs API-Key (xi-api-key). Wird nur im Electron-Hauptprozess verwendet. */
  elevenKey: string;
  /** ElevenLabs Voice-ID. Standard: die 230%-Offiziell-Stimme. */
  elevenVoiceId: string;
  /** Lautstärke 0–1 für beide Engines. */
  ttsVolume: number;
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
  elevenKey: '',
  elevenVoiceId: 'lzfdHZ2QD3sqy4zwTwi2',
  ttsVolume: 1.0,
  voiceURI: '',
  voiceRate: 1.0,
  voicePitch: 1.0,
  continuousVoice: false,
};
