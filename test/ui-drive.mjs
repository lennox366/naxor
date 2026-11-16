// CDP-Treiber für echte UI-Tests der Electron-App (localhost:9333).
// Aufruf: node test/ui-drive.mjs <szenario>
//   scenario1 = Chat-Programmierauftrag → Agent → Datei + Sandbox-Apply
//   scenario2 = Wissens-Abfrage in neuem Chat
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(t => t.type === 'page');
if (!page) { console.error('Keine Page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 0;
const pending = new Map();
const dialogs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Page.javascriptDialogOpening') {
    dialogs.push(m.params.message);
    console.log(`[DIALOG] ${m.params.type}: ${String(m.params.message).slice(0, 200)}`);
    send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  }
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
const waitFor = async (expr, timeout = 60000, poll = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await ev(expr);
    if (v) return v;
    await sleep(poll);
  }
  return null;
};
const sendChat = async (text) => {
  await ev(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return 'NO_TEXTAREA';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(400);
  await ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'no-btn'; })()`);
};

const scenario = process.argv[2] || 'scenario1';
console.log('Szenario:', scenario);
console.log('App bereit?', await ev(`document.readyState + ' | textarea:' + !!document.querySelector('textarea')`));

if (scenario === 'scenario1') {
  // Wartet bis Dashboard-Composer sichtbar (view=dashboard default)
  const ok = await waitFor(`!!document.querySelector('textarea')`, 30000);
  if (!ok) { console.log('KEIN Composer gefunden'); process.exit(1); }
  await sendChat('Erstelle eine Datei uitest.txt mit dem Inhalt ui-test-ok. Danach führe run_test aus: command "python -c \\"print(40+2)\\"", expect "42".');
  console.log('Nachricht gesendet, warte auf Agent…');
  // Warte auf Verifikationsbericht oder Done-Text (max 5 Min)
  const done = await waitFor(`document.body.innerText.includes('Verifikationsbericht')`, 300000, 5000);
  console.log('Bericht sichtbar:', !!done);
  const bodyText = await ev(`document.body.innerText.slice(-4000)`);
  console.log('--- LETZTER CHAT-AUSSCHNITT ---');
  console.log(bodyText);
  console.log('--- DIALOGE ---', dialogs.length);
}

if (scenario === 'scenario2') {
  // Neuen Chat anlegen: Sidebar → „Neuer Chat" → Dashboard → senden
  await ev(`[...document.querySelectorAll('button, .nav-item')].find(b => b.textContent.includes('Neuer Chat'))?.click()`);
  await sleep(1500);
  const ok = await waitFor(`!!document.querySelector('textarea')`, 20000);
  if (!ok) { console.log('KEIN Composer'); process.exit(1); }
  await sendChat('Welche Datei wurde in diesem Projekt zuletzt vom Coding-Agenten erstellt und welches Testergebnis wurde verifiziert? Antworte kurz.');
  const done = await waitFor(`document.querySelector('.chat-inner, main, .view')?.innerText.length > 200`, 240000, 5000);
  await sleep(3000);
  const bodyText = await ev(`document.body.innerText.slice(-3000)`);
  console.log('--- CHAT-AUSSCHNITT ---');
  console.log(bodyText);
}

ws.close();
process.exit(0);
