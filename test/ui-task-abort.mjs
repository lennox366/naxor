// Test E: Abbruch einer laufenden Agent-Aufgabe — nur diese, Status 'abgebrochen'.
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

await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`);
await sleep(1200);
await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  const opt = [...proj.options].find(o => o.value.includes('explorer-fixture'));
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
await setComposer('Untersuche das gesamte Projekt und erstelle danach eine Datei abort-test.txt mit Inhalt ABGEBROCHEN.');
console.log('send:', await ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`));
await sleep(20000); // Agent läuft
console.log('vor Stopp — Stopp-Button:', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`));
console.log('stop:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.includes('Stopp')); if (b) { b.click(); return 'clicked'; } return 'none'; })()`));
await sleep(5000);
console.log('nach Stopp — Stopp-Button:', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`));
const lastMsg = await ev(`(() => { const m = [...document.querySelectorAll('.msg.assistant .bubble')]; return m.length ? m[m.length-1].innerText.slice(0,500) : ''; })()`);
console.log('letzte msg:', (lastMsg || '').slice(0, 400));
console.log('Datei abort-test.txt existiert:', fs.existsSync(path.join(FIXTURE, 'abort-test.txt')) || fs.existsSync(path.join(FIXTURE, 'src/abort-test.txt')));
process.exit(0);
