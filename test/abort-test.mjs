// Test: Agent startet langlaufenden Prozess, Nutzer bricht ab -> Prozessbaum muss sterben.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

const ROOT = path.resolve('test-projekt');
const FILES_DIR = path.resolve('test-projekt/.backups');
await fs.mkdir(FILES_DIR, { recursive: true });

const skip = new Set(['node_modules', '.git', 'dist', '.next', 'bin', 'obj', '__pycache__']);
const safeJoin = (root, rel) => {
  const p = path.resolve(root, String(rel || '.'));
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Pfad außerhalb: ' + rel);
  return p;
};

const studio = {
  app: { paths: async () => ({ userData: FILES_DIR, filesDir: FILES_DIR, dbPath: FILES_DIR + '/db' }) },
  fs: {
    readDir: async (dir) => (await fs.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.')).map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dir, e.name) })),
    readFile: async (p, max = 2e6) => fs.readFile(p, 'utf8'),
    writeFile: async (p, c) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, c, 'utf8'); return true; },
    deletePath: async (r, rel) => { await fs.rm(safeJoin(r, rel), { recursive: true }); return true; },
    renamePath: async (r, f, t) => { await fs.rename(safeJoin(r, f), safeJoin(r, t)); return true; },
    mkdir: async (r, rel) => { await fs.mkdir(safeJoin(r, rel || '.'), { recursive: true }); return true; },
    exists: async (r, rel) => { try { await fs.access(safeJoin(r, rel)); return true; } catch { return false; } },
    stat: async (r, rel) => { const st = await fs.stat(safeJoin(r, rel)); return { size: st.size, isDir: st.isDirectory(), mtime: st.mtimeMs }; },
    listTree: async (root, opts = {}) => {
      const out = [];
      async function walk(dir, depth) {
        if (depth > (opts.maxDepth ?? 4) || out.length > 3000) return;
        let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const en of ents) { if (en.name.startsWith('.') && depth > 0) continue; if (skip.has(en.name)) continue;
          const p = path.join(dir, en.name); const isDir = en.isDirectory();
          out.push({ name: en.name, path: p, isDir, depth }); if (isDir) await walk(p, depth + 1); }
      }
      await walk(path.resolve(root), 0); return out;
    },
  },
  term: {
    _runs: new Map(),
    run: ({ cwd, command, timeoutMs = 180000, runId }) => new Promise((resolve) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-Command', command], { cwd, windowsHide: true });
      if (runId) studio.term._runs.set(runId, proc);
      let stdout = '', stderr = '';
      const to = setTimeout(() => resolve({ code: -1, stdout, stderr, timedOut: true }), timeoutMs);
      proc.stdout.on('data', d => stdout += d); proc.stderr.on('data', d => stderr += d);
      proc.on('close', c => { clearTimeout(to); if (runId) studio.term._runs.delete(runId); resolve({ code: c, stdout, stderr }); });
    }),
    kill: async (runId) => {
      const proc = studio.term._runs.get(runId);
      if (!proc) return false;
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      setTimeout(() => { try { proc.kill(); } catch {} }, 800);
      return true;
    },
  },
};
globalThis.window = { studio };

const { runAgent } = await import('./agent.bundle.mjs');
const rows = [];
globalThis.__q = (sql, p=[]) => rows;
globalThis.__r = (sql, p=[]) => {};
// db stub substitute: agent imports db — patch via module? bundle already has stub; ok.

const ac = new AbortController();
const settings = { provider: 'custom', customUrl: 'http://localhost:8080/v1', customModel: 'x', customKey: '', ollamaUrl: '', ollamaModel: '', openaiKey: '', openaiModel: '', openaiUrl: '', sttMode: '', sttEndpoint: '', ttsVoice: '', ttsRate: 1, autoSpeak: false, voiceMode: false };

const pyCount = () => { try { return execSync('tasklist /FI "IMAGENAME eq python.exe" /NH').toString().split('\n').filter(l => l.includes('python')).length; } catch { return -1; } };

console.log('python.exe vor Start:', pyCount());
const t0 = Date.now();
const done = runAgent({
  settings, projectRoot: ROOT, projectName: 'test', history: [],
  userMessage: 'Führe den Befehl „python loop.py" mit dem Werkzeug run_command aus. Das Programm läuft endlos — starte es einfach.',
  signal: ac.signal,
  onConfirmCommand: async () => true,
  onEvent: (e) => {
    if (e.type === 'tool') console.log(`[TOOL ${e.name}]`, JSON.stringify(e.args).slice(0,120), '->', String(e.result||'').slice(0,80).replace(/\n/g,' '));
    else if (e.type === 'done') console.log('[DONE]', e.text);
    else if (e.type === 'error') console.log('[ERROR]', e.text);
  },
});

// Warte bis python läuft, dann abbrechen
let waited = 0;
const iv = setInterval(() => {
  waited += 2000;
  const n = pyCount();
  console.log(`t+${waited/1000}s python.exe=${n}`);
  if (n > 0 || waited > 90000) {
    clearInterval(iv);
    console.log('>>> ABORT <<<');
    ac.abort();
  }
}, 2000);

await done;
await new Promise(r => setTimeout(r, 2500));
console.log('python.exe nach Abbruch:', pyCount());
console.log(`Gesamtzeit: ${((Date.now()-t0)/1000).toFixed(0)}s`);
process.exit(0);
