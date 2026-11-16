import fs from 'node:fs';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  const opt = [...proj.options].find(o => o.value.replace(/\\\\/g,'/').endsWith('/test/explorer-fixture'));
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  const ta = document.querySelector('.composer textarea');
  const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  s.call(ta, 'Analysiere dieses Projekt kurz: Welche Sprachen und Build-Dateien gibt es?');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
console.log('send:', await ev(`(() => { const b=document.querySelector('.send-btn'); if(b&&!b.disabled){b.click();return 'clicked';} return 'disabled'; })()`));
// warte auf answer (max 6min)
const t0 = Date.now();
while (Date.now() - t0 < 360000) {
  await sleep(15000);
  const done = await ev(`(() => { const msgs=[...document.querySelectorAll('.msg.assistant .bubble')]; const l=msgs[msgs.length-1]; return l && !document.querySelector('.send-btn')?.disabled && l.innerText.length>50 ? l.innerText.slice(-800) : null; })()`);
  if (done) { console.log('ANTWORT:', done.slice(0, 700)); break; }
}
process.exit(0);
