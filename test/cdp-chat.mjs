// CDP-Treiber: echte UI-Interaktion im laufenden Electron.
const list = await (await fetch('http://localhost:9223/json')).json();
const page = list.find(t => t.type === 'page');
if (!page) { console.log('kein Page-Target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails) };
  return r.result?.result?.value;
};

// 1) Was ist sichtbar?
console.log('URL:', await evl('location.href'));
console.log('textarea:', await evl(`!!document.querySelector('textarea')`));
console.log('buttons:', await evl(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0,20)`));
console.log('body text (ausschnitt):', await evl(`document.body.innerText.slice(0,600)`));
ws.close();
process.exit(0);
