// Vollständiger Live-Funktionstest: dev-task Projekt
import fs from 'node:fs';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PROOT = 'C:/Users/User/Desktop/tasten/Code KI alles/test/dev-task';

const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout')), 90000); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };

await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`);
await sleep(1500);
await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  const opt = [...proj.options].find(o => o.value.replace(/\\\\/g,'/').endsWith('/test/dev-task'));
  if (!opt) return 'NO_PROJECT';
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  const ta = document.querySelector('.composer textarea');
  const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  s.call(ta, 'Analysiere dieses Projekt. Füge eine Funktion dividiere zu src/rechner.js hinzu und exportiere sie. Erweitere src/main.js, damit dividiere(10,2) ausgegeben wird. Es gibt einen Fehler: subtrahiere liefert falsche Ergebnisse — finde und behebe ihn. Führe dann node src/main.js aus und prüfe die Ausgabe.');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
console.log('send:', await ev(`(() => { const b=document.querySelector('.send-btn'); if(b&&!b.disabled){b.click();return 'clicked';} return 'disabled'; })()`));

// Warte bis Task terminal (DB-Status) — max 9 Min
const t0 = Date.now();
let status = 'läuft';
const { execSync } = await import('node:child_process');
while (Date.now() - t0 < 540000) {
  await sleep(15000);
  try {
    const out = execSync('node test/taskstatus.mjs', { cwd: process.cwd(), encoding: 'utf8' });
    status = out.trim();
    if (['erfolgreich','fehlgeschlagen','abgebrochen','unterbrochen'].includes(status)) break;
  } catch { /* retry */ }
}
console.log('TASK STATUS:', status, '| dauer', Math.round((Date.now()-t0)/1000), 's');
process.exit(0);
