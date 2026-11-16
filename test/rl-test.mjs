// Deterministischer replace_lines-Test: gültige/einzelne/mehrzeilige/ungültige
// Zeilenbereiche + UTF-8 (Umlaute/Emoji). Fake-OpenAI-Server, kein echtes Modell.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ROOT = path.resolve('test/rl-projekt');
const FILES_DIR = path.resolve('test/rl-projekt/.backups');
await fs.mkdir(FILES_DIR, { recursive: true });
await fs.mkdir(path.join(ROOT, 'src'), { recursive: true });

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

let script = [], requestCount = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    requestCount++;
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const step = script[Math.min(requestCount - 1, script.length - 1)];
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (step.tool) send({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${requestCount}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.arguments) } }] } }] });
      if (step.text) send({ choices: [{ delta: { content: step.text } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(8091, r));

const settings = {
  provider: 'custom', customUrl: 'http://localhost:8091/v1', customModel: 'fake', customKey: '',
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'x', openaiKey: '', openaiModel: '', openaiUrl: '',
  sttMode: 'webspeech', sttEndpoint: '', ttsVoice: '', ttsRate: 1, autoSpeak: false, voiceMode: false,
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra); } };
const toolRes = (tools, name, i = 0) => tools.filter(t => t.name === name)[i]?.result || '';

async function runScenario(steps) {
  script = steps; requestCount = 0;
  const events = [];
  await runAgent({
    settings, projectRoot: ROOT, projectName: 'rl-projekt',
    history: [], userMessage: 'Testauftrag',
    onEvent: (e) => events.push(e),
    onConfirmCommand: async () => true,
  });
  return { events, tools: events.filter(e => e.type === 'tool' && e.result !== undefined) };
}

// Testdatei: 6 Zeilen, Zeile 2 = Ziel für Einzelersetzung
await fs.writeFile(path.join(ROOT, 'src/test.js'), [
  'function eins() { return 1; }',
  'function zwei() { return 2; }',
  'function drei() { return 3; }',
  'function vier() { return 4; }',
  'function fuenf() { return 5; }',
  'module.exports = { eins, zwei, drei, vier, fuenf };',
].join('\n') + '\n', 'utf8');

// ---------- S1: gültige Einzelzeilen-Ersetzung ----------
{
  const r = await runScenario([
    { tool: { name: 'read_file', arguments: { path: 'src/test.js' } } },
    { tool: { name: 'replace_lines', arguments: { path: 'src/test.js', start_line: 2, end_line: 2, new_text: 'function zwei() { return 22; }' } } },
    { tool: { name: 'read_file', arguments: { path: 'src/test.js' } } },
    { text: 'Fertig.' },
  ]);
  const res = toolRes(r.tools, 'replace_lines');
  check('S1: replace_lines erfolgreich', !/FEHLER/.test(res), res.slice(0, 150));
  const content = await fs.readFile(path.join(ROOT, 'src/test.js'), 'utf8');
  check('S1: Zeile 2 geändert', content.includes('return 22;'), '');
  check('S1: Zeile 1 unverändert', content.includes('return 1;'), '');
  check('S1: Zeile 6 unverändert', content.includes('module.exports'), '');
}

// ---------- S2: ungültiger Bereich (start > end) ----------
{
  const r = await runScenario([
    { tool: { name: 'read_file', arguments: { path: 'src/test.js' } } },
    { tool: { name: 'replace_lines', arguments: { path: 'src/test.js', start_line: 5, end_line: 2, new_text: 'x' } } },
    { text: 'Fertig.' },
  ]);
  const res = toolRes(r.tools, 'replace_lines');
  check('S2: start>end → FEHLER', /FEHLER|fehler|ungültig|invalid/i.test(res), res.slice(0, 150));
}

// ---------- S3: Bereich außerhalb der Datei ----------
{
  const r = await runScenario([
    { tool: { name: 'read_file', arguments: { path: 'src/test.js' } } },
    { tool: { name: 'replace_lines', arguments: { path: 'src/test.js', start_line: 50, end_line: 60, new_text: 'x' } } },
    { text: 'Fertig.' },
  ]);
  const res = toolRes(r.tools, 'replace_lines');
  check('S3: out-of-bounds → FEHLER', /FEHLER|fehler|ungültig|außerhalb|Zeile/i.test(res), res.slice(0, 150));
  const content = await fs.readFile(path.join(ROOT, 'src/test.js'), 'utf8');
  check('S3: Datei unverändert', content.includes('return 22;') && content.split('\n').length <= 8, '');
}

// ---------- S4: mehrzeilige Ersetzung ----------
{
  const r = await runScenario([
    { tool: { name: 'read_file', arguments: { path: 'src/test.js' } } },
    { tool: { name: 'replace_lines', arguments: { path: 'src/test.js', start_line: 3, end_line: 4, new_text: 'function drei() { return 33; }\nfunction vier() { return 44; }' } } },
    { tool: { name: 'read_file', arguments: { path: 'src/test.js' } } },
    { text: 'Fertig.' },
  ]);
  const res = toolRes(r.tools, 'replace_lines');
  check('S4: mehrzeilig erfolgreich', !/FEHLER/.test(res), res.slice(0, 150));
  const content = await fs.readFile(path.join(ROOT, 'src/test.js'), 'utf8');
  check('S4: beide Zeilen geändert', content.includes('return 33;') && content.includes('return 44;'), '');
  check('S4: Zeilenzahl korrekt (6)', content.trim().split('\n').length === 6, `→ ${content.trim().split('\n').length}`);
}

// ---------- S5: UTF-8 Umlaute + Emoji ----------
{
  await fs.writeFile(path.join(ROOT, 'src/utf8.js'), '// Testdatei\nconst text = "hallo";\nmodule.exports = text;\n', 'utf8');
  const r = await runScenario([
    { tool: { name: 'read_file', arguments: { path: 'src/utf8.js' } } },
    { tool: { name: 'replace_lines', arguments: { path: 'src/utf8.js', start_line: 2, end_line: 2, new_text: 'const text = "Grüße 🎉 aus München —_override_";' } } },
    { tool: { name: 'read_file', arguments: { path: 'src/utf8.js' } } },
    { text: 'Fertig.' },
  ]);
  const res = toolRes(r.tools, 'replace_lines');
  check('S5: UTF-8-Ersetzung erfolgreich', !/FEHLER/.test(res), res.slice(0, 150));
  const content = await fs.readFile(path.join(ROOT, 'src/utf8.js'), 'utf8');
  check('S5: Umlaute/Emoji korrekt auf Platte', content.includes('Grüße 🎉 aus München'), JSON.stringify(content));
  const raw = await fs.readFile(path.join(ROOT, 'src/utf8.js'));
  check('S5: gültiges UTF-8 (kein Mojibake)', raw.includes(Buffer.from('Grüße', 'utf8')) && !content.includes('Ã'), '');
}

// ---------- S6: replace_lines ohne vorheriges read_file (Read-first) ----------
{
  const r = await runScenario([
    { tool: { name: 'replace_lines', arguments: { path: 'src/utf8.js', start_line: 1, end_line: 1, new_text: '// neu' } } },
    { text: 'Fertig.' },
  ]);
  const res = toolRes(r.tools, 'replace_lines');
  check('S6: ohne read_file → blockiert', /FEHLER|lesen|read/i.test(res), res.slice(0, 150));
}

server.close();
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
