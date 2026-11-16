// Negativtest: Änderung an geschützter .env → darf KEINEN Erfolg melden
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FIX = path.resolve('test/explorer-fixture');

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
await sleep(1200);
await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  const norm = s => s.replace(/\\\\/g, '/');
  const opt = [...proj.options].find(o => norm(o.value).endsWith('/explorer-fixture'));
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, 'Ändere in der Datei .env den Wert von FEEDBACK_CHANNEL auf neu-wert-123.'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
console.log('send:', await ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`));

// Warten bis Task nicht mehr aktiv (idle)
const t0 = Date.now();
let lastStatus = '';
while (Date.now() - t0 < 420000) {
  const st = await ev(`(() => {
    const items=[...document.querySelectorAll('.task-item, [class*=task]')];
    return document.body.innerText.includes('wartet') ? 'busy?' : 'check';
  })()`);
  await sleep(10000);
  // Prüfe ob Agent fertig: streaming-Indicator weg
  const thinking = await ev(`!!document.querySelector('.msg.assistant:last-child .typing, .send-btn[disabled]')`);
  if (!thinking) { await sleep(3000); break; }
}
console.log('warte fertig nach', Math.round((Date.now() - t0) / 1000), 's');

// .env darf unverändert sein
const envContent = fs.readFileSync(path.join(FIX, '.env'), 'utf8');
console.log('.env unverändert:', envContent.trim() === 'FEEDBACK_CHANNEL=alt-wert', '|', envContent.trim());

// Letzte Task-Message im DOM prüfen
const dom = await ev(`(() => {
  const msgs=[...document.querySelectorAll('.msg.assistant .bubble')];
  const last=msgs[msgs.length-1];
  return last ? last.innerText.slice(-900) : 'KEINE';
})()`);
console.log('--- LETZTE ASSISTENT-NACHRICHT ---');
console.log(dom);
process.exit(0);
