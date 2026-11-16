import fs from 'node:fs';
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
  const opt = [...proj.options].find(o => o.value.replace(/\\/g,'/').endsWith('/explorer-fixture'));
  if (!opt) return 'NO_PROJECT';
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const confirmVisible = () => ev(`!!document.querySelector('.agent-confirm')`);
const gotoTasks = () => ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Aufgaben'))?.click()`);
const clickChatAt = (i) => ev(`(() => { const items=[...document.querySelectorAll('.chat-item')]; if(items[${i}]){items[${i}].click();return 'ok';} return 'none'; })()`);

console.log('=== TEST D2: Bestätigung ===');
await newChat();
console.log('setup:', await setupProject());
await setComposer('Nutze run_command (kein run_test!) mit command: del queue-a.txt — lösche damit die Datei queue-a.txt im Projekt.');
console.log('send:', await clickSend());
const t0 = Date.now(); let confirmed = false;
while (Date.now() - t0 < 300000) {
  if (await confirmVisible()) { confirmed = true; break; }
  // Abbruch wenn Agent fertig ohne Confirm
  const busy = await ev(`!!document.querySelector('.chat-wrap .typing') || [...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`);
  if (!busy && Date.now() - t0 > 30000) break;
  await sleep(5000);
}
console.log('Bestätigung sichtbar:', confirmed);
if (confirmed) {
  await clickChatAt(1); await sleep(2000);
  await clickChatAt(0); await sleep(2000);
  console.log('nach Wechsel sichtbar:', await confirmVisible());
  await gotoTasks(); await sleep(1500);
  console.log('auf Aufgaben-Seite sichtbar:', await ev(`!!document.querySelector('.agent-confirm')`));
  console.log('Aktion:', await ev(`(() => { const b=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Ablehnen')); if(b){b.click();return 'abgelehnt';} const a=[...document.querySelectorAll('.agent-confirm .btn')].find(x=>x.innerText.includes('Erlauben')); if(a){a.click();return 'erlaubt';} return 'keine'; })()`));
  await sleep(3000);
  await clickChatAt(0); await sleep(1500);
  console.log('nach Antwort weg:', !(await confirmVisible()));
} else {
  const lastMsg = await ev(`(() => { const m=[...document.querySelectorAll('.msg.assistant .bubble')]; return m.length?m[m.length-1].innerText.slice(0,400):''; })()`);
  console.log('reply:', (lastMsg||'').slice(0,300));
}
process.exit(0);
