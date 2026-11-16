// CDP-Test v2: Chatwechsel/Remount darf KEINE Nachricht erneut senden.
// Zählt echte Netzwerk-Requests (fetch → /chat/completions, /api/chat)
// UND User-Nachrichten im DOM. Prüft außerdem Abbruch (Stopp).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(t => t.type === 'page');
if (!page) { console.error('Keine Page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 30000);
});
await send('Page.enable');
await send('Runtime.enable');

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || 'JS-Fehler' };
  return r.result?.result?.value;
};
const waitFor = async (expr, timeout = 60000, poll = 1500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await ev(expr);
    if (v) return v;
    await sleep(poll);
  }
  return null;
};

// Netzwerk-Request-Zähler injizieren (einmalig, überlebt Remounts — window-Level)
await ev(`(() => {
  if (window.__reqLog) return 'already';
  window.__reqLog = [];
  const of = window.fetch;
  window.fetch = function(...a) {
    try {
      const u = String(a[0]?.url || a[0]);
      if (u.includes('chat/completions') || u.includes('/api/chat')) {
        window.__reqLog.push({ url: u, t: Date.now() });
      }
    } catch {}
    return of.apply(this, a);
  };
  return 'instrumented';
})()`);
const reqCount = () => ev(`window.__reqLog.length`);
const reqUrls = () => ev(`window.__reqLog.map(r => r.url)`);

const chatTitles = () => ev(`[...document.querySelectorAll('.chat-item .t')].map(e => e.innerText)`);
const clickChat = (title) => ev(`(() => {
  const items = [...document.querySelectorAll('.chat-item')];
  const it = items.find(d => d.innerText.includes(${JSON.stringify(title)}));
  if (it) { it.click(); return 'clicked'; }
  return 'NOT_FOUND';
})()`);
const sendInComposer = async (text) => {
  await ev(`(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => t.offsetParent !== null);
    if (!ta) return 'NO_TEXTAREA';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(300);
  return ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'no-btn'; })()`);
};
const countUser = (marker) => ev(`(() => {
  const users = [...document.querySelectorAll('.msg.user .bubble')];
  return { marker: users.filter(b => b.innerText.includes(${JSON.stringify(marker)})).length, total: users.length };
})()`);
const isBusy = () => ev(`!!document.querySelector('.typing') || [...document.querySelectorAll('button')].some(b => b.innerText.trim() === '■ Stopp')`);
const waitIdle = async (timeout = 240000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (!(await isBusy())) return true; await sleep(2000); }
  return false;
};
const clickStop = () => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '■ Stopp'); if (b) { b.click(); return 'stopped'; } return 'no-stop'; })()`);

console.log('App:', await ev(`document.readyState`));
console.log('Requests vor Test:', await reqCount());

// ============ TEST 1: Send + 3× Chatwechsel während Antwort läuft ============
let titles = await chatTitles();
if (!titles || titles.length < 2) { console.log('ZU WENIG CHATS'); process.exit(1); }
const tA = titles[0], tB = titles[1];
console.log('ChatA:', tA.slice(0, 40), '| ChatB:', tB.slice(0, 40));

await clickChat(tA); await sleep(1200);
const reqBefore = await reqCount();
console.log('send A:', await sendInComposer('Antworte nur mit dem Wort: SW2-AAA-777'));
await sleep(400);

for (let i = 0; i < 3; i++) {
  await clickChat(tB); await sleep(500);
  await clickChat(tA); await sleep(500);
}
// noch einmal B → A (letzter Zustand: A sichtbar)
await clickChat(tB); await sleep(400);
await clickChat(tA); await sleep(600);

const idle = await waitIdle(240000);
console.log('idle:', idle, '| Requests während Send A:', (await reqCount()) - reqBefore);
await sleep(1500);
const resA = await countUser('SW2-AAA-777');
console.log('ChatA:', JSON.stringify(resA), '(erwartet marker=1)');
await clickChat(tB); await sleep(1200);
const resB = await countUser('SW2-AAA-777');
console.log('ChatB:', JSON.stringify(resB), '(erwartet marker=0)');

// ============ TEST 2: Abbruch — Send, Stopp, dann neuer Send muss funktionieren ============
await clickChat(tA); await sleep(1000);
const reqB4 = await reqCount();
console.log('send A2 (lang):', await sendInComposer('Schreibe einen langen Text von mindestens 300 Wörtern über das Meer. Fange mit SW2-STOP an.'));
await sleep(1500); // Request läuft
const stopRes = await clickStop();
console.log('stopp:', stopRes);
await waitIdle(60000);
await sleep(1000);
const aborted = await ev(`document.body.innerText.includes('abgebrochen')`);
console.log('Abbruch markiert:', aborted, '| Requests A2:', (await reqCount()) - reqB4, '(erwartet 1)');
// Nach Abbruch muss ein neuer Send funktionieren (Registry aufgeräumt)
console.log('send A3 nach Abbruch:', await sendInComposer('Antworte nur mit: SW2-NACH-STOPP'));
await waitIdle(180000);
await sleep(1000);
const resA3 = await countUser('SW2-NACH-STOPP');
console.log('ChatA nach A3:', JSON.stringify(resA3), '(erwartet marker=1)');
const totalReq = await reqCount();
console.log('Requests gesamt:', totalReq, '| URLs:', JSON.stringify(await reqUrls()));

// ============ TEST 3: Dashboard-Pending-Send + Remounts ============
await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Neuer Chat'))?.click()`);
await sleep(1500);
console.log('dashboard send:', await sendInComposer('Antworte nur mit: SW2-PEND-999'));
await sleep(400);
// Schnell zwischen Chats wechseln während Pending-Send verarbeitet wird
const titles2 = await chatTitles();
const other = titles2.find(t => !t.includes('Neuer Chat')) || titles2[1];
if (other) { await clickChat(other); await sleep(400); }
await clickChat('Neuer Chat'); await sleep(800);
const resP = await countUser('SW2-PEND-999');
console.log('Pending-Chat:', JSON.stringify(resP), '(erwartet marker=1)');
// Remount twice more
if (other) { await clickChat(other); await sleep(400); await clickChat('Neuer Chat'); await sleep(800); }
const resP2 = await countUser('SW2-PEND-999');
console.log('Pending-Chat nach Remounts:', JSON.stringify(resP2), '(erwartet marker=1)');

console.log('=== FERTIG ===');
console.log('Requests total:', await reqCount());
ws.close();
process.exit(0);
