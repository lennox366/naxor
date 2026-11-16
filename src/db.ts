import initSqlJs, { Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let db: Database | null = null;
let dbPath = 'studio.db';
const WEB_DB_KEY = 'naxora-web-db';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(bin);
}

export async function initDB(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  try {
    const paths = await (window as any).studio.app.paths();
    dbPath = paths.dbPath;
  } catch { /* browser fallback */ }

  let saved: Uint8Array | null = null;
  try {
    const text = await (window as any).studio.fs.readFile(dbPath);
    saved = b64ToBytes(text.trim());
  } catch {
    // Browser-Fallback: lokale Persistenz über localStorage (Web-Version)
    try {
      const ls = localStorage.getItem(WEB_DB_KEY);
      if (ls) saved = b64ToBytes(ls.trim());
    } catch { /* fresh db */ }
  }

  db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT DEFAULT 'chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge(scope, kind);
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      project_name TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      log TEXT NOT NULL DEFAULT '',
      result TEXT,
      pending_confirm TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_chat ON agent_tasks(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_task ON agent_events(task_id, ts);
  `);
  // Migration: verified-Spalte für bestehende Datenbanken
  try { db.run('ALTER TABLE knowledge ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch { /* existiert bereits */ }
  scheduleSave();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 800);
}

async function persist() {
  if (!db) return;
  const b64 = bytesToB64(db.export());
  const st = (window as any).studio;
  if (st?.fs) {
    try {
      await st.fs.writeFile(dbPath, b64);
    } catch (e) {
      console.error('DB persist failed', e);
    }
    return;
  }
  try { localStorage.setItem(WEB_DB_KEY, b64); } catch { /* Speicher voll */ }
}

export function query<T = any>(sql: string, params: any[] = []): T[] {
  if (!db) throw new Error('DB nicht initialisiert');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

export function run(sql: string, params: any[] = []): void {
  if (!db) throw new Error('DB nicht initialisiert');
  db.run(sql, params);
  scheduleSave();
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
