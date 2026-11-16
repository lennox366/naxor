// Test C: Zwei Aufgaben im SELBEN Projekt → zweite muss in Warteschlange.
// Test E: Abbruch NUR der wartenden/laufenden Aufgabe.
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const F1 = path.resolve('test/explorer-fixture');
const DB = path.join(process.env.APPDATA, 'ai-developer-studio', 'studio.db');
const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');

const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout')), 60000); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };

const newChat = async () => { await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`); await sleep(1200); };
const setupProject = (suffix) => ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  const norm = s => s.replace(/\\\\/g, '/');
  const opt = [...proj.options].find(o => norm(o.value).endsWith('/' + ${JSON.stringify(suffix)}));
  if (!opt) return 'NO_PROJECT';
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const taskStatuses = async () => {
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const db = new SQL.Database(Uint8Array.from(atob(fs.readFileSync(DB, 'utf8').trim()), c => c.charCodeAt(0)));
  const r = db.exec("SELECT id,status,substr(prompt,1,40) FROM agent_tasks WHERE prompt LIKE '%queue-%' ORDER BY created_at");
  return r.length ? r[0].values : [];
};
const findFile = (name) => { const hits = []; const walk = (d, depth) => { if (depth > 4) return; try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory() && !['node_modules', '.git'].includes(f.name)) walk(p, depth + 1); else if (f.name === name) hits.push(p); } } catch {} }; walk(F1, 0); return hits; };

console.log('=== TEST C: Warteschlange gleiches Projekt ===');
await newChat();
await setupProject('explorer-fixture');
await setComposer('Erstelle die Datei queue-a.txt mit dem Inhalt QUEUE-A. Lies danach kurz index.js und fasse zusammen.');
console.log('send A:', await clickSend());
await sleep(8000);
await newChat();
await setupProject('explorer-fixture');
await setComposer('Erstelle die Datei queue-b.txt mit dem Inhalt QUEUE-B.');
console.log('send B:', await clickSend());
await sleep(15000);
console.log('Status nach ~23s:', JSON.stringify(await taskStatuses()));

// Warten bis beide fertig (max 8 Min)
const t0 = Date.now();
let a = false, b = false;
while (Date.now() - t0 < 480000) {
  a = findFile('queue-a.txt').length > 0;
  b = findFile('queue-b.txt').length > 0;
  if (a && b) { await sleep(20000); break; } //.extra Zeit für Status-Update
  await sleep(5000);
}
console.log('A:', a, findFile('queue-a.txt'));
console.log('B:', b, findFile('queue-b.txt'));
console.log('finale Status:', JSON.stringify(await taskStatuses()));
process.exit(0);
