// Deterministischer Agent-Test mit Fake-OpenAI-Server (SSE).
// Prüft: Auto-Text-Command-Freigabe, Codeblock-Ausschluss, Reparatur-Limit, Protokoll-Vollständigkeit.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ROOT = path.resolve('test-projekt');
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
    readDir: async (dir) => (await fs.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.')).map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dir, e.name) })),
    readFile: async (p, max = 2_000_000) => { const st = await fs.stat(p); if (st.size > max) throw new Error('Datei zu groß'); return fs.readFile(p, 'utf8'); },
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
const { runAgent } = await import('./agent.bundle.mjs');

// ---------- Fake-OpenAI-Server (SSE) ----------
let script = [];
let requestCount = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    requestCount++;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const step = script[Math.min(requestCount - 1, script.length - 1)];
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (step.tool) {
        send({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${requestCount}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.arguments) } }] } }] });
      }
      if (step.text) send({ choices: [{ delta: { content: step.text } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(8090, r));

const settings = {
  provider: 'custom', customUrl: 'http://localhost:8090/v1', customModel: 'fake', customKey: '',
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'x', openaiKey: '', openaiModel: '', openaiUrl: '',
  sttMode: 'webspeech', sttEndpoint: '', ttsVoice: '', ttsRate: 1, autoSpeak: false, voiceMode: false,
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra); } };

async function runScenario(name, steps, confirmFn) {
  script = steps; requestCount = 0;
  const events = [];
  const confirms = [];
  await runAgent({
    settings, projectRoot: ROOT, projectName: 'test-projekt',
    history: [], userMessage: 'Testauftrag',
    onEvent: (e) => events.push(e),
    onConfirmCommand: async (cmd) => { confirms.push(cmd); return confirmFn ? confirmFn(cmd) : true; },
  });
  const tools = events.filter(e => e.type === 'tool' && e.result !== undefined); // nur die Events MIT Ergebnis (es gibt je Aufruf zwei)
  const verify = events.find(e => e.type === 'verify')?.text || '';
  const done = events.filter(e => e.type === 'done').map(e => e.text).join('\n');
  console.log(`\n=== ${name} ===`);
  console.log('tool-Events:', tools.map(t => `${t.name}${t.args?.autoFromText ? '(autoText)' : ''}`).join(', ') || '(keine)');
  console.log('confirm-Calls:', confirms.length);
  return { events, tools, verify, done, confirms, requests: requestCount };
}

// ---------- Szenario A: Reparatur-Limit (3× Fehler → Stopp) ----------
{
  const r = await runScenario('A: 3 fehlgeschlagene Tests', [
    { tool: { name: 'run_command', arguments: { command: 'node -e "process.exit(1)"' } } },
    { tool: { name: 'run_command', arguments: { command: 'node -e "process.exit(2)"' } } },
    { tool: { name: 'run_command', arguments: { command: 'python -c "import sys; sys.exit(3)"' } } },
    { text: 'Sollte nie erreicht werden.' },
    { text: 'Sollte nie erreicht werden.' },
  ]);
  const runCmds = r.tools.filter(t => t.name === 'run_command');
  check('A: genau 3 run_command ausgeführt', runCmds.length === 3, `→ ${runCmds.length}`);
  check('A: alle 3 protokolliert (ok=false)', runCmds.filter(t => t.ok === false).length === 3);
  check('A: Agent hat nach 3 Fehlern gestoppt', r.done.includes('Automatisch angehalten'), r.done.slice(0, 200));
  check('A: kein 4. Versuch (requests <= 4)', r.requests <= 4, `→ ${r.requests}`);
  check('A: Bericht listet 3 Befehle', (r.verify.match(/Exit -?\d/g) || []).length >= 3, r.verify.slice(0, 300));
  check('A: Status Fehlgeschlagen', r.verify.includes('Fehlgeschlagen'));
  check('A: eindeutige Befehls-IDs', /-c1/.test(r.verify) && /-c2/.test(r.verify) && /-c3/.test(r.verify));
}

// ---------- Szenario B: Auto-Text-Command ABGELEHNT ----------
{
  const r = await runScenario('B: Auto-Text ohne Freigabe', [
    { text: 'Ich führe das aus: run_command("python rechner.py")' },
    { text: 'Verstanden, abgebrochen.' },
  ], () => false);
  const runCmds = r.tools.filter(t => t.name === 'run_command');
  check('B: KEIN Befehl ausgeführt (abgelehnt)', runCmds.length === 0 || runCmds.every(t => t.result?.includes('nicht freigegeben')), JSON.stringify(runCmds.map(t => t.result)));
  check('B: Freigabe wurde angefragt', r.confirms.length >= 1, `→ ${r.confirms.length}`);
  check('B: Bericht „Nicht ausgeführt"', r.verify.includes('Nicht ausgeführt'), r.verify.slice(0, 200));
}

// ---------- Szenario C: Codeblock wird NICHT auto-ausgeführt ----------
{
  const r = await runScenario('C: Nur Codeblock im Text', [
    { text: 'Hier ist der Befehl:\n```bash\nnode -e "process.exit(7)"\n```\nDas sollte nicht automatisch laufen.' },
    { text: 'Fertig.' },
  ]);
  const runCmds = r.tools.filter(t => t.name === 'run_command');
  check('C: Codeblock NICHT ausgeführt', runCmds.length === 0, `→ ${runCmds.length}`);
  check('C: kein Confirm für Codeblock', r.confirms.length === 0, `→ ${r.confirms.length}`);
}

// ---------- Szenario D: Auto-Text MIT Freigabe läuft + Protokoll ----------
{
  await fs.writeFile(path.join(ROOT, 'rechner.py'), 'print(42)\n');
  const r = await runScenario('D: Auto-Text mit Freigabe', [
    { text: 'Ausführen: run_command("python rechner.py")' },
    { text: 'Erledigt.' },
  ], () => true);
  const runCmds = r.tools.filter(t => t.name === 'run_command');
  check('D: Befehl nach Freigabe ausgeführt', runCmds.length === 1 && runCmds[0].ok === true, JSON.stringify(runCmds.map(t => ({ ok: t.ok, res: (t.result || '').slice(0, 80) }))));
  check('D: stdout im Tool-Result', (runCmds[0]?.result || '').includes('42'));
  check('D: Bericht „Funktionstest bestanden"', r.verify.includes('Funktionstest bestanden'), r.verify.slice(0, 300));
}

// ---------- Szenario E: Neuer Auftrag nach Limit unbeeinträchtigt ----------
{
  const r = await runScenario('E: Folgeauftrag nach Limit', [
    { tool: { name: 'run_command', arguments: { command: 'node -e "console.log(1)"' } } },
    { text: 'OK' },
  ]);
  check('E: neuer Auftrag läuft normal', r.tools.filter(t => t.name === 'run_command').length === 1);
  check('E: Status bestanden', r.verify.includes('Funktionstest bestanden'));
}

server.close();
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
