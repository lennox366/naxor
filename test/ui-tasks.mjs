// Test: Coding-Aufgabe läuft unabhängig vom geöffneten Chat (Hintergrund-Runtime).
// A: Aufgabe in Chat A starten → zu Chat B wechseln → Datei muss trotzdem entstehen.
// C: Chat A schließen/wieder öffnen → Fortschritt sichtbar.
// D: Zweite Aufgabe im anderen Chat → Warteschlange/Parallele korrekt getrennt.
// E: Abbruch nur der eigenen Aufgabe.
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FIXTURE = path.resolve('test/explorer-fixture');

const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout')), 60000); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };

const fileExists = (rel) => { try { return fs.existsSync(path.join(FIXTURE, rel)); } catch { return false; } };
const fileContent = (rel) => { try { return fs.readFileSync(path.join(FIXTURE, rel), 'utf8'); } catch { return null; } };

const newChat = async () => {
  await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`);
  await sleep(1200);
};
const setupCoding = () => ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  if (!proj || !mode) return 'MISSING';
  const opt = [...proj.options].find(o => o.value.includes('explorer-fixture'));
  if (!opt) return 'NO_PROJECT';
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const chatItems = () => ev(`[...document.querySelectorAll('.chat-item')].map(e => e.innerText.split('\\n')[0].trim())`);
const clickChatAt = (i) => ev(`(() => { const items = [...document.querySelectorAll('.chat-item')]; if (items[${i}]) { items[${i}].click(); return 'clicked'; } return 'none'; })()`);
const thinking = () => ev(`!!document.querySelector('.chat-wrap .typing') || [...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`);
const agentTasks = () => ev(`(async()=>{ return 'n/a'; })()`);
// Task-Status direkt aus der Runtime lesen (Modul-State via window? nein — über DOM/DB)
// Einfacher: Chat-Inhalt + Datei-System prüfen.

// ---------- Test A: Aufgabe in Chat A, wechseln zu Chat B ----------
console.log('=== TEST A: Hintergrund-Agent ===');
await newChat();
console.log('setup:', await setupCoding());
await setComposer('Erstelle eine Datei hintergrund-test.txt mit dem Inhalt HINTERGRUND-LAEUFT.');
console.log('send A:', await clickSend());
await sleep(4000); // Agent startet
// Chat B anlegen und öffnen
await newChat();
console.log('Chats:', await chatItems());
// Mehrfach zwischen den Chats wechseln während die Aufgabe läuft
for (let i = 0; i < 3; i++) {
  await clickChatAt(0); await sleep(2500);
  await clickChatAt(1); await sleep(2500);
}
// Warten bis Datei da ist oder Timeout (max 6 Min)
const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 360000) {
  if (fileExists('hintergrund-test.txt')) { done = true; break; }
  await sleep(5000);
}
console.log('Datei erstellt:', done, done ? JSON.stringify(fileContent('hintergrund-test.txt')) : '');
// Zurück zu Chat A (erster Chat in Liste = ältester? chat-item order — idx 0 ist evtl. neuester)
await clickChatAt(0); await sleep(2000);
const msgsA = await ev(`[...document.querySelectorAll('.msg')].map(m => m.className).join('|')`);
console.log('chat A msgs:', String(msgsA).slice(0, 200));
const lastA = await ev(`(() => { const m = [...document.querySelectorAll('.msg.assistant .bubble')]; return m.length ? m[m.length-1].innerText.slice(0,600) : ''; })()`);
console.log('letzte Antwort in aktuellem Chat:', (lastA || '').slice(0, 400));
process.exit(0);
