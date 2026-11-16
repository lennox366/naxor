import { AISettings, defaultSettings } from '../types';
import { query, run } from '../db';

export function loadSettings(): AISettings {
  const rows = query<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: any = { ...defaultSettings };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out as AISettings;
}

export function saveSettings(s: AISettings) {
  for (const [k, v] of Object.entries(s)) {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(v)]);
  }
}

export interface OllamaModel { name: string }

export interface OllamaModelInfo {
  name: string;
  size: number;
  modified_at?: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export async function checkOllama(baseUrl: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = await res.json();
    return { ok: true, version: j.version };
  } catch (e: any) {
    return { ok: false, error: e.message || 'nicht erreichbar' };
  }
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama Fehler ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m: any) => ({
    name: m.name,
    size: m.size || 0,
    modified_at: m.modified_at,
    details: m.details,
  }));
}

export async function pullOllamaModel(
  baseUrl: string, name: string,
  onProgress: (status: string, completed?: number, total?: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Pull fehlgeschlagen: ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        onProgress(j.status || '', j.completed, j.total);
      } catch (e: any) { if (e.message && !line.includes('completed')) throw e; }
    }
  }
}

export async function deleteOllamaModel(baseUrl: string, name: string): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Löschen fehlgeschlagen: ${res.status}`);
}

/** Sendet eine Mini-Anfrage an ein Ollama-Modell und misst die Antwortzeit. */
export async function testOllamaModel(baseUrl: string, name: string): Promise<{ ok: boolean; ms?: number; reply?: string; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: name,
        stream: false,
        keep_alive: '2m',
        options: { num_predict: 8, temperature: 0 },
        messages: [{ role: 'user', content: 'Antworte mit einem Wort: ok' }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, ms, error: friendlyOllamaError(res.status, t) };
    }
    const j = await res.json();
    return { ok: true, ms, reply: (j.message?.content || '').slice(0, 60) };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - t0, error: e.name === 'TimeoutError' ? 'Zeitüberschreitung (120s)' : e.message };
  }
}

export const CODING_MODEL_SUGGESTIONS = [
  'qwen2.5-coder:7b',
  'qwen2.5-coder:14b',
  'deepseek-coder-v2:16b',
  'codellama:7b',
  'codellama:13b',
  'llama3.1:8b',
  'mistral:7b',
  'phi4:14b',
  'gemma3:12b',
  'devstral:24b',
];

export const CHAT_MODEL_SUGGESTIONS = [
  'llama3.1:8b',
  'llama3.1:70b',
  'mistral:7b',
  'gemma3:12b',
  'phi4:14b',
  'qwen2.5:14b',
];

export async function ollamaChat(
  baseUrl: string, model: string, messages: { role: string; content: string }[],
  onToken: (t: string) => void, signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(friendlyOllamaError(res.status, txt));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const t = j.message?.content || '';
        if (t) { full += t; onToken(t); }
      } catch { /* partial */ }
    }
  }
  return full;
}

export async function openAIChat(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: string }[],
  onToken: (t: string) => void, signal?: AbortSignal
): Promise<string> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`API-Fehler: ${res.status} ${await res.text().catch(() => '')}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const tok = j.choices?.[0]?.delta?.content || '';
        if (tok) { full += tok; onToken(tok); }
      } catch { /* partial */ }
    }
  }
  return full;
}

// ---------- Ollama tool-calling (for the coding agent) ----------
export interface ToolCall { function: { name: string; arguments: any } }
export interface ToolDef { type: 'function'; function: { name: string; description: string; parameters: any } }

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** One agent step: streams tokens, returns assistant message incl. tool_calls. */
export async function ollamaAgentStep(
  baseUrl: string, model: string,
  messages: AgentMessage[], tools: ToolDef[],
  onToken: (t: string) => void, signal?: AbortSignal
): Promise<AgentMessage> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(friendlyOllamaError(res.status, txt));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const toolCalls: ToolCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const t = j.message?.content || '';
        if (t) { content += t; onToken(t); }
        const tc = j.message?.tool_calls;
        if (tc) {
          for (const c of tc) {
            const idx = c.function?.index ?? toolCalls.length;
            if (!toolCalls[idx]) toolCalls[idx] = { function: { name: '', arguments: {} } };
            if (c.function?.name) toolCalls[idx].function.name = c.function.name;
            const args = c.function?.arguments;
            if (typeof args === 'string') {
              try { toolCalls[idx].function.arguments = JSON.parse(args); } catch { /* partial json accumulates below */ }
            } else if (args) {
              toolCalls[idx].function.arguments = { ...toolCalls[idx].function.arguments, ...args };
            }
          }
        }
      } catch { /* partial */ }
    }
  }
  const valid = toolCalls.filter(Boolean);
  return { role: 'assistant', content, ...(valid.length ? { tool_calls: valid } : {}) };
}

/** OpenAI-compatible tool step (for custom endpoints / llama-server /v1). */
export async function openAIToolStep(
  baseUrl: string, apiKey: string, model: string,
  messages: AgentMessage[], tools: ToolDef[],
  onToken: (t: string) => void, signal?: AbortSignal
): Promise<AgentMessage> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const oaiMessages = messages.map(m => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    const out: any = { role: m.role, content: m.content || '' };
    if (m.tool_calls) {
      out.tool_calls = m.tool_calls.map((c, i) => ({
        id: (c as any).id || `call_${i}`,
        type: 'function',
        function: { name: c.function.name, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}) },
      }));
    }
    return out;
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: oaiMessages, tools, stream: true, max_tokens: 1500 }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(friendlyOllamaError(res.status, txt));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const toolCalls: any[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const j = JSON.parse(p);
        const d = j.choices?.[0]?.delta;
        if (d?.content) { content += d.content; onToken(d.content); }
        if (d?.tool_calls) {
          for (const c of d.tool_calls) {
            const idx = c.index ?? toolCalls.length;
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (c.id) toolCalls[idx].id = c.id;
            if (c.function?.name) toolCalls[idx].function.name += c.function.name;
            if (c.function?.arguments) toolCalls[idx].function.arguments += c.function.arguments;
          }
        }
      } catch { /* partial */ }
    }
  }
  const valid = toolCalls.filter(Boolean).map(c => ({
    id: c.id || `call_${Math.random().toString(36).slice(2, 8)}`,
    function: {
      name: c.function.name,
      arguments: (() => { try { return JSON.parse(c.function.arguments || '{}'); } catch { return {}; } })(),
    },
  }));
  return { role: 'assistant', content, ...(valid.length ? { tool_calls: valid as any } : {}) };
}

/** Turn raw Ollama/API errors into understandable German messages. */
export function friendlyOllamaError(status: number, body: string): string {
  const lower = (body + '').toLowerCase();
  if (status === 404 && (lower.includes('not found') || lower.includes('does not exist'))) {
    return 'Das ausgewählte Modell ist nicht installiert. Öffne die Einstellungen → KI-Provider → „Modelle verwalten“, um es zu laden oder ein anderes Modell zu wählen.';
  }
  if (status === 404) return 'Endpunkt nicht gefunden — ist Ollama gestartet? (ollama serve)';
  if (lower.includes('out-of-memory') || lower.includes('unable to allocate') || (lower.includes('cuda') && lower.includes('memory'))) {
    return 'Nicht genügend GPU-/Arbeitsspeicher für dieses Modell. Wähle ein kleineres Modell in den Einstellungen (z. B. 3B-Quantisierung) oder schließe andere GPU-Anwendungen.';
  }
  if (lower.includes('llama-server') || lower.includes('wsarecv') || lower.includes('remotehost') || lower.includes('closed')) {
    return 'Das KI-Modell konnte nicht geladen werden — der lokale Server ist abgestürzt (meist zu wenig freier GPU-/RAM-Speicher). Bitte ein kleineres Modell wählen (z. B. qwen2.5vl:3b oder ein 3B-Modell) oder andere GPU-Programme schließen.';
  }
  if (lower.includes('connection') || status === 0) return 'Ollama ist nicht erreichbar. Bitte sicherstellen, dass Ollama läuft (http://localhost:11434).';
  if (status === 401 || status === 403) return 'API-Zugang verweigert — bitte API-Key in den Einstellungen prüfen.';
  if (status === 400 && lower.includes('model')) return 'Modellfehler — bitte in den Einstellungen ein installiertes Modell wählen.';
  return `KI-Fehler ${status}: ${body.slice(0, 300) || 'unbekannt'}`;
}

export async function generateText(settings: AISettings, prompt: string, system?: string): Promise<string> {
  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  let full = '';
  await sendChat(settings, messages, t => { full += t; });
  return full;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function sendChat(
  settings: AISettings, messages: ChatMessage[],
  onToken: (t: string) => void, signal?: AbortSignal
): Promise<string> {
  switch (settings.provider) {
    case 'local':
      throw new Error('Provider „local" muss über effectiveSettings() aufgelöst werden.');
    case 'ollama':
      return ollamaChat(settings.ollamaUrl, settings.ollamaModel, messages, onToken, signal);
    case 'openai':
      return openAIChat('https://api.openai.com/v1', settings.openaiKey, settings.openaiModel, messages, onToken, signal);
    case 'custom': {
      if (!settings.customUrl?.trim()) {
        throw new Error('Keine API-URL konfiguriert (Provider „Eigener Endpoint" hat ein leeres URL-Feld). Bitte in den Einstellungen den Provider „Lokal Universal" wählen oder eine Endpoint-URL eintragen.');
      }
      const base = settings.customUrl.replace(/\/$/, '');
      const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
      // openAIChat appends /chat/completions; handle both cases
      if (base.endsWith('/chat/completions')) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(settings.customKey ? { Authorization: `Bearer ${settings.customKey}` } : {}) },
          body: JSON.stringify({ model: settings.customModel, messages, stream: true }),
          signal,
        });
        if (!res.ok || !res.body) throw new Error(`API-Fehler: ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '', full = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const p = t.slice(5).trim();
            if (p === '[DONE]') continue;
            try {
              const j = JSON.parse(p);
              const tok = j.choices?.[0]?.delta?.content || '';
              if (tok) { full += tok; onToken(tok); }
            } catch { /* partial */ }
          }
        }
        return full;
      }
      return openAIChat(settings.customUrl, settings.customKey, settings.customModel, messages, onToken, signal);
    }
    default:
      throw new Error('Kein KI-Provider konfiguriert');
  }
}
