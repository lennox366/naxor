// Echter Agent-End-to-End-Test: runAgent() gegen echte Dateien + laufenden llama-server.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(process.env.TEST_ROOT || 'test-projekt');
const FILES_DIR = path.resolve('test-projekt/.backups');
await fs.mkdir(FILES_DIR, { recursive: true });

const skip = new Set(['node_modules', '.git', 'dist', '.next', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'target', 'release', '.idea', '.vs']);
const safeJoin = (root, rel) => {
  const p = path.resolve(root, String(rel || '.'));
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Pfad außerhalb des Projektordners: ' + rel);
  return p;
};

const studio = {
  app: { paths: async () => ({ userData: FILES_DIR, filesDir: FILES_DIR, dbPath: FILES_DIR + '/db' }) },
  fs: {
    readDir: async (dir) => {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      return ents.filter(e => !e.name.startsWith('.')).map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dir, e.name) }));
    },
    readFile: async (p, max = 2_000_000) => {
      const st = await fs.stat(p);
      if (st.size > max) throw new Error('Datei zu groß');
      return fs.readFile(p, 'utf8');
    },
    writeFile: async (p, c) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, c, 'utf8'); return true; },
    deletePath: async (root, rel) => { await fs.rm(safeJoin(root, rel), { recursive: true }); return true; },
    renamePath: async (root, from, to) => { await fs.rename(safeJoin(root, from), safeJoin(root, to)); return true; },
    mkdir: async (root, rel) => { await fs.mkdir(safeJoin(root, rel || '.'), { recursive: true }); return true; },
    exists: async (root, rel) => { try { await fs.access(safeJoin(root, rel)); return true; } catch { return false; } },
    stat: async (root, rel) => { const st = await fs.stat(safeJoin(root, rel)); return { size: st.size, isDir: st.isDirectory(), mtime: st.mtimeMs }; },
    listTree: async (root, opts = {}) => {
      const maxDepth = opts.maxDepth ?? 4; const out = [];
      async function walk(dir, depth) {
        if (depth > maxDepth || out.length > 3000) return;
        let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const en of ents) {
          if (en.name.startsWith('.') && depth > 0) continue;
          if (skip.has(en.name)) continue;
          const p = path.join(dir, en.name); const isDir = en.isDirectory();
          out.push({ name: en.name, path: p, isDir, depth });
          if (isDir) await walk(p, depth + 1);
        }
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
      const to = setTimeout(() => { try { proc.kill(); } catch {} resolve({ code: -1, stdout, stderr, timedOut: true }); }, timeoutMs);
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => { clearTimeout(to); if (runId) studio.term._runs.delete(runId); resolve({ code, stdout, stderr }); });
      proc.on('error', e => { clearTimeout(to); resolve({ code: -1, stdout, stderr: String(e) }); });
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
const { runAgent, _rows, applySandboxChanges, discardSandbox } = await import('./agent.bundle.mjs');

const settings = {
  provider: 'custom', customUrl: 'http://localhost:8080/v1', customModel: 'qwen2.5-coder-3b', customKey: '',
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'x', openaiKey: '', openaiModel: '', openaiUrl: '',
  sttMode: 'webspeech', sttEndpoint: '', ttsVoice: '', ttsRate: 1, autoSpeak: false, voiceMode: false,
};

const prompt = process.argv[2] || 'Im Projekt liegt rechner.py mit einem Bug (add subtrahiert). Lies die Datei, korrigiere den Bug, erstelle eine Datei hallo.py die "Hallo Welt" ausgibt, und führe beide Dateien mit python aus um das Ergebnis zu prüfen.';

console.log('=== AGENT-START ===');
console.log('Prompt:', prompt);
const t0 = Date.now();
const result = await runAgent({
  settings, projectRoot: ROOT, projectName: 'test-projekt',
  history: [], userMessage: prompt,
  sandbox: process.env.SANDBOX === '1',
  onEvent: (e) => {
    if (e.type === 'tool') console.log(`\n[TOOL ${e.name}] args=${JSON.stringify(e.args).slice(0, 200)}`);
    else if (e.type === 'filechange') console.log(`[FILECHANGE] ${e.text}`);
    else if (e.type === 'confirm') console.log(`[CONFIRM] ${e.text}`);
    else if (e.type === 'verify') console.log(`\n[VERIFY]\n${e.text}`);
    else if (e.type === 'error') console.log(`[ERROR] ${e.text}`);
    else if (e.type === 'done') console.log(`\n[DONE] ${e.text}`);
    else if (e.type === 'token') process.stdout.write(e.text || '');
  },
  onConfirmCommand: async (cmd) => { console.log(`\n[CONFIRM-REQUEST] ${cmd}`); return true; },
});
console.log(`\n=== AGENT ENDE nach ${((Date.now() - t0) / 1000).toFixed(0)}s ===`);
const kb = _rows ? _rows() : [];
if (kb.length) {
  console.log(`\n[WISSENSSPEICHER] ${kb.length} Einträge:`);
  for (const r of kb.slice(-5)) console.log(`  - [${r.kind}${r.verified ? ' ✓' : ''}] ${r.title} (scope=${r.scope === 'global' ? 'global' : 'projekt'})`);
}
if (result?.sandboxRoot) {
  console.log(`\n[SANDBOX] root=${result.sandboxRoot}`);
  console.log(`[SANDBOX] geänderte Dateien: ${result.changedFiles.join(', ') || '(keine)'}`);
  const origFile = path.join(ROOT, result.changedFiles[0] || '___none___');
  console.log(`[SANDBOX] Original unverändert? ${result.changedFiles.every(f => { try { fss.accessSync(path.join(ROOT, f)); return false; } catch { return true; } }) ? 'JA (Dateien existieren noch nicht im Original)' : 'NEIN — prüfen!'}`);
  if (process.env.APPLY === '1' && result.changedFiles.length) {
    const res = await applySandboxChanges(ROOT, result.sandboxRoot, result.changedFiles);
    console.log(`[SANDBOX-APPLY] applied=${res.applied.join(',') || '-'} failed=${res.failed.join(',') || '-'} skipped=${res.skipped.length}`);
    for (const f of res.applied) console.log(`  übernommen: ${f} → ${fss.existsSync(path.join(ROOT, f)) ? 'existiert im Original' : 'FEHLT!'}`);
    await discardSandbox(result.sandboxRoot);
    console.log('[SANDBOX] Kopie verworfen');
  }
}
