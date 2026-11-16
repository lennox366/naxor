// Positivtest: feedbackChannelId in BOT-TESTKOPIE ändern + verifizieren
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CFG = path.resolve('test/bot-copy/Ticket-System.json');

const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout')), 90000); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };

const t0 = Date.now();
await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`);
await sleep(1500);
const setup = await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  if (!proj || !mode) return 'MISSING';
  const opt = [...proj.options].find(o => o.value.replace(/\\\\/g,'/').endsWith('/test/bot-copy'));
  if (!opt) return 'NO_PROJECT: ' + [...proj.options].map(o=>o.value).join('|');
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
console.log('setup:', setup);
await ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, 'Suche in diesem Projekt nach feedbackChannelId, finde die richtige Konfigurationsdatei, lies sie vollständig, ändere den feedbackChannelId-Wert auf 1569408831300042793, speichere die Datei und lies sie danach erneut, um den neuen Wert zu verifizieren.'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
console.log('send:', await ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`));

// Warten bis Agent fertig (send-btn wieder enabled + kein streaming)
let waited = 0;
while (waited < 540000) {
  await sleep(10000); waited += 10000;
  const busy = await ev(`(() => { const b=document.querySelector('.send-btn'); const think=[...document.querySelectorAll('*')].some(e=>e.className&&String(e.className).includes('typing')); return b?.disabled || think; })()`);
  if (!busy) { await sleep(4000); break; }
}
console.log('wartete', Math.round(waited / 1000), 's');

// Externe Verifikation der Datei
const raw = fs.readFileSync(CFG, 'utf8');
let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = { __parseError: e.message }; }
const g = parsed?.guilds?.['1559659266737176699'];
console.log('=== DATEI-VERIFIKATION ===');
console.log('JSON valide:', !parsed.__parseError, parsed.__parseError || '');
console.log('alter Wert:', '1563985687328587786', '| neuer Wert in Datei:', g?.feedbackChannelId);
console.log('KORREKT:', g?.feedbackChannelId === '1569408831300042793');
console.log('--- Dateiinhalt ---'); console.log(raw);
process.exit(0);
