// Test D (Sandbox-Pfad): Agent ändert Datei in Sandbox-Kopie →
// Bestätigungs-Card erscheint → Chatwechsel → Aufgaben-Seite → Übernehmen →
// Datei muss im ORIGINAL-Projekt geändert sein.
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const F1 = path.resolve('test/explorer-fixture');
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
const setupProject = () => ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  if (!proj || !mode) return 'MISSING';
  const opt = [...proj.options].find(o => o.value.indexOf('explorer-fixture') >= 0 && o.value.indexOf('fixture2') < 0);
  if (!opt) return 'NO_PROJECT';
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const confirmVisible = () => ev(`!!document.querySelector('.agent-confirm')`);
const confirmKind = () => ev(`(() => { const el=document.querySelector('.agent-confirm-title'); return el?el.innerText:''; })()`);
const gotoTasks = () => ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Aufgaben'))?.click()`);
const clickChatAt = (i) => ev(`(() => { const items=[...document.querySelectorAll('.chat-item')]; if(items[${i}]){items[${i}].click();return 'ok';} return 'none'; })()`);
const fileContent = (rel) => { try { return fs.readFileSync(path.join(F1, rel), 'utf8'); } catch { return null; } };
const findFile = (name) => { const hits=[]; const walk=(d,dep)=>{ if(dep>4)return; try{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name); if(f.isDirectory()&&!['node_modules','.git','.aistudio'].includes(f.name))walk(p,dep+1); else if(f.name===name)hits.push(p);}}catch{} }; walk(F1,0); return hits; };

console.log('=== TEST D (Sandbox-Confirm) ===');
// Testdatei anlegen, die der Agent ändern soll
fs.writeFileSync(path.join(F1, 'sandbox-test.txt'), 'ALT-STATUS\n');
await newChat();
console.log('setup:', await setupProject());
await setComposer('Ändere den Inhalt von sandbox-test.txt auf NEU-STATUS.');
console.log('send:', await clickSend());

const t0 = Date.now(); let confirmed = false;
while (Date.now() - t0 < 360000) {
  if (await confirmVisible()) { confirmed = true; break; }
  const busy = await ev(`!!document.querySelector('.chat-wrap .typing') || [...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`);
  if (!busy && Date.now() - t0 > 60000) break;
  await sleep(5000);
}
console.log('Confirm sichtbar:', confirmed, '| Art:', confirmed ? await confirmKind() : '-');
if (!confirmed) {
  const lastMsg = await ev(`(() => { const m=[...document.querySelectorAll('.msg.assistant .bubble')]; return m.length?m[m.length-1].innerText.slice(0,400):''; })()`);
  console.log('reply:', (lastMsg||'').slice(0,300));
  process.exit(0);
}
// Original noch unverändert? (Sandbox)
const before = findFile('sandbox-test.txt').map(f => fileContent(path.relative(F1, f)));
console.log('Original-Inhalt vor Übernahme:', JSON.stringify(before));
// Chat wechseln → zurück → Aufgaben-Seite → Übernehmen
await clickChatAt(1); await sleep(2000);
await gotoTasks(); await sleep(1500);
console.log('Confirm auf Aufgaben-Seite:', await ev(`!!document.querySelector('.agent-confirm')`));
console.log('Aktion:', await ev(`(() => { const b=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Übernehmen')); if(b){b.click();return 'übernommen';} const a=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Verwerfen')); if(a){a.click();return 'verworfen';} const e=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Erlauben')); if(e){e.click();return 'erlaubt';} return 'keine'; })()`));
await sleep(5000);
const after = findFile('sandbox-test.txt').map(f => fileContent(path.relative(F1, f)));
console.log('Original-Inhalt nach Übernahme:', JSON.stringify(after));
console.log('NEU-STATUS im Original:', after.some(c => c && c.includes('NEU-STATUS')));
process.exit(0);
