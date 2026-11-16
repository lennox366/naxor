// Test A+B: Zwei Coding-Aufgaben in zwei verschiedenen Projekten parallel.
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const F1 = path.resolve('test/explorer-fixture');
const F2 = path.resolve('test/explorer-fixture2');

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
// Exakter Projekt-Pfad-Abgleich (fixture vs fixture2 kollidieren als Substring!)
const setupProject = (suffix) => ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  if (!proj || !mode) return 'MISSING';
  const norm = s => s.replace(/\\\\/g, '/');
  const opt = [...proj.options].find(o => norm(o.value).endsWith('/' + ${JSON.stringify(suffix)}));
  if (!opt) return 'NO_PROJECT:' + ${JSON.stringify(suffix)};
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const clickChatAt = (i) => ev(`(() => { const items=[...document.querySelectorAll('.chat-item')]; if(items[${i}]){items[${i}].click();return 'ok';} return 'none'; })()`);
const findFile = (root, name) => { const hits = []; const walk = (d, depth) => { if (depth > 4) return; try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory() && f.name !== 'node_modules' && f.name !== '.git') walk(p, depth + 1); else if (f.name === name) hits.push(p); } } catch {} }; walk(root, 0); return hits; };

// ---------- A+B: parallel in verschiedenen Projekten ----------
console.log('=== TEST A+B: parallel, verschiedene Projekte ===');
// Chat A → fixture1
await newChat();
console.log('setup A:', await setupProject('explorer-fixture'));
await setComposer('Erstelle die Datei parallel-a.txt mit dem Inhalt PROJEKT-EINS.');
console.log('send A:', await clickSend());
await sleep(3000);
// Chat B → fixture2
await newChat();
console.log('setup B:', await setupProject('explorer-fixture2'));
await setComposer('Erstelle die Datei parallel-b.txt mit dem Inhalt PROJEKT-ZWEI.');
console.log('send B:', await clickSend());

// Warten bis beide Dateien existieren (max 8 Min)
const t0 = Date.now();
let a = false, b = false;
while (Date.now() - t0 < 480000) {
  a = findFile(F1, 'parallel-a.txt').length > 0;
  b = findFile(F2, 'parallel-b.txt').length > 0;
  if (a && b) break;
  await sleep(5000);
}
console.log('A datei:', a, findFile(F1, 'parallel-a.txt'));
console.log('B datei:', b, findFile(F2, 'parallel-b.txt'));
if (a) console.log('A inhalt:', JSON.stringify(fs.readFileSync(findFile(F1, 'parallel-a.txt')[0], 'utf8').slice(0, 80)));
if (b) console.log('B inhalt:', JSON.stringify(fs.readFileSync(findFile(F2, 'parallel-b.txt')[0], 'utf8').slice(0, 80)));
process.exit(0);
