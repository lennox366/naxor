// Echter Chat-Test über die UI: Nachricht tippen, senden, Antwort/Error lesen.
const list = await (await fetch('http://localhost:9223/json')).json();
const page = list.find(t => t.type === 'page');
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
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails).slice(0, 500) };
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Chat öffnen: auf "Neuer Chat" klicken falls kein Chat aktiv
const hasChat = await evl(`!!document.querySelector('.chat-scroll')`);
console.log('chat-scroll vorhanden:', hasChat);
if (!hasChat) {
  await evl(`[...document.querySelectorAll('button, a, div[role=button]')].find(e => /Neuer Chat/i.test(e.textContent))?.click()`);
  await sleep(800);
}

// Nachricht in textarea eingeben (React-kompatibel)
const typed = await evl(`(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'KEIN TEXTAREA';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'Antworte nur mit einem Wort: Wie heißt die Hauptstadt Deutschlands?');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
})()`);
console.log('Eingabe:', typed);
await sleep(300);

// Senden-Button klicken
const clicked = await evl(`(() => {
  const b = document.querySelector('.send-btn');
  if (!b) return 'KEIN SEND-BUTTON';
  if (b.disabled) return 'BUTTON DISABLED';
  b.click();
  return 'OK';
})()`);
console.log('Senden:', clicked);

// Auf Antwort oder Fehler pollen (max 90s)
for (let i = 0; i < 30; i++) {
  await sleep(3000);
  const state = await evl(`(() => {
    const bubbles = [...document.querySelectorAll('.chat-scroll *')].map(e => e.textContent || '');
    const err = document.body.innerText.match(/Fehler: [^\\n]{0,200}/);
    const thinking = /denkt nach|thinking/i.test(document.body.innerText);
    // letzte Nachricht-Blase
    const msgs = [...document.querySelectorAll('[class*=message], [class*=bubble], .chat-inner > div')];
    const last = msgs.length ? msgs[msgs.length-1].innerText.slice(0,300) : '';
    return { err: err ? err[0] : null, thinking, last, bodyLen: document.body.innerText.length };
  })()`);
  console.log(`t+${(i+1)*3}s:`, JSON.stringify(state).slice(0, 400));
  if (state.err || (state.last && !state.thinking && i > 2)) break;
}
ws.close();
process.exit(0);
