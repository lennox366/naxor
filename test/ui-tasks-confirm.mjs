// Test D: Bestätigungsanforderung auslösen → Chat wechseln → zurück → beantworten.
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  const opt = [...proj.options].find(o => o.value.replace(/\\\\/g,'/').endsWith('/explorer-fixture'));
  if (!opt) return 'NO_PROJECT';
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const confirmVisible = () => ev(`!!document.querySelector('.agent-confirm')`);
const clickChatAt = (i) => ev(`(() => { const items=[...document.querySelectorAll('.chat-item')]; if(items[${i}]){items[${i}].click();return 'ok';} return 'none'; })()`);
const gotoTasks = () => ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Aufgaben'))?.click()`);

console.log('=== TEST D: Bestätigung im Hintergrund ===');
await newChat();
console.log('setup:', await setupProject());
// Prompt, der einen dangerous run_command auslösen soll
await setComposer('Führe den Terminalbefehl „del queue-a.txt“ mit dem Werkzeug run_command aus, um die Datei im Projekt zu löschen.');
console.log('send:', await clickSend());

// Auf Bestätigung warten (max 4 Min)
const t0 = Date.now();
let confirmed = false;
while (Date.now() - t0 < 240000) {
  if (await confirmVisible()) { confirmed = true; break; }
  await sleep(5000);
}
console.log('Bestätigung sichtbar im Chat:', confirmed);
if (!confirmed) {
  // Vielleicht wurde delete_path benutzt oder Modell verweigerte — Status prüfen
  const lastMsg = await ev(`(() => { const m=[...document.querySelectorAll('.msg.assistant .bubble')]; return m.length?m[m.length-1].innerText.slice(0,500):''; })()`);
  console.log('reply:', (lastMsg||'').slice(0,300));
  process.exit(0);
}

// Zu anderem Chat wechseln und zurück
await clickChatAt(1); await sleep(2000);
await clickChatAt(0); await sleep(2000);
console.log('nach Wechsel — Bestätigung noch sichtbar:', await confirmVisible());
// Aufgaben-Seite: Bestätigung dort beantworten
await gotoTasks(); await sleep(1500);
const tasksConfirm = await ev(`!!document.querySelector('.agent-confirm')`);
console.log('Bestätigung auf Aufgaben-Seite sichtbar:', tasksConfirm);
const btn = await ev(`(() => { const b=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Ablehnen')); if(b){b.click();return 'abgelehnt';} const a=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Erlauben')); if(a){a.click();return 'erlaubt';} return 'keine'; })()`);
console.log('Aktion:', btn);
await sleep(3000);
// Zurück in den Chat
await clickChatAt(0); await sleep(1500);
console.log('Bestätigung weg nach Antwort:', !(await confirmVisible()));
process.exit(0);
