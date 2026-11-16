// CDP-Test: Chatwechsel darf KEINE Nachricht erneut senden.
// Verifiziert pro Chat die Anzahl der .msg.user-Blasen mit Marker-Text.
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

const chatTitles = () => ev(`[...document.querySelectorAll('.chat-item .t')].map(e => e.innerText)`);
const clickChat = (title) => ev(`(() => {
  const items = [...document.querySelectorAll('.chat-item')];
  const it = items.find(d => d.innerText.includes(${JSON.stringify(title)}));
  if (it) { it.click(); return 'clicked:' + it.innerText.slice(0,40); }
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
// Anzahl User-Nachrichten mit Marker + Gesamtzahl User-Nachrichten im sichtbaren Chat
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

console.log('App:', await ev(`document.readyState + ' | textarea:' + !!document.querySelector('textarea')`));

// --- Test 1: Nachricht senden, während Antwort läuft mehrfach den Chat wechseln ---
let titles = await chatTitles();
console.log('Chats vorhanden:', JSON.stringify(titles));
if (!titles || titles.length < 2) { console.log('ZU WENIG CHATS — Test abgebrochen'); process.exit(1); }
const tA = titles[0], tB = titles[1];
console.log('ChatA:', tA, '| ChatB:', tB);

await clickChat(tA);
await sleep(1200);
const beforeA = await countUser('SWITCHTEST');
console.log('send in A:', await sendInComposer('Antworte nur mit dem Wort: SWITCHTEST-AAA-777'));
await sleep(400); // Request läuft an

// Mehrfach hin- und herschalten während die Antwort läuft
for (let i = 0; i < 3; i++) {
  console.log(' switch→B:', await clickChat(tB)); await sleep(500);
  console.log(' switch→A:', await clickChat(tA)); await sleep(500);
}
console.log('warte auf Abschluss…');
const idle = await waitIdle(240000);
console.log('idle:', idle);

// Zurück in A: Marker darf genau 1× als User-Nachricht erscheinen
await clickChat(tA); await sleep(1500);
const resA = await countUser('SWITCHTEST-AAA-777');
console.log('ChatA Ergebnis:', JSON.stringify(resA), '(erwartet marker=1)');

// In B: keine SWITCHTEST-Nachricht, User-Anzahl unverändert
await clickChat(tB); await sleep(1200);
const resB = await countUser('SWITCHTEST-AAA-777');
console.log('ChatB Ergebnis:', JSON.stringify(resB), '(erwartet marker=0)');

// --- Test 2: Dashboard-Pending-Send, dann sofort Chatwechsel ---
await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Neuer Chat'))?.click()`);
await sleep(1500);
console.log('dashboard send:', await sendInComposer('Antworte nur mit: PENDING-TEST-BBB-888'));
await sleep(500);
// Sofort in bestehenden Chat und zurück wechseln
console.log(' switch→A:', await clickChat(tA)); await sleep(400);
console.log(' switch→neu:', await clickChat('PENDING-TEST'));
await sleep(800);
const resNew = await countUser('PENDING-TEST-BBB-888');
console.log('Neuer Chat Ergebnis:', JSON.stringify(resNew), '(erwartet marker=1)');

// Nochmal zurück zum neuen Chat nach kurzer Zeit (Remount) → kein zweiter Send
await clickChat(tB); await sleep(400);
await clickChat('PENDING-TEST'); await sleep(1000);
const resNew2 = await countUser('PENDING-TEST-BBB-888');
console.log('Neuer Chat nach Remount:', JSON.stringify(resNew2), '(erwartet marker=1)');

ws.close();
process.exit(0);
