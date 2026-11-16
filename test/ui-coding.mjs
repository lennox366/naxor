// CDP-E2E: normaler Chat im Coding-Modus führt echte Programmieraufgaben aus.
// Fixture: test/explorer-fixture (auth.js mit login(), config/settings.json mit feedbackChannelId)
// Voraussetzung: provider=ollama, ollamaModel=qwen2.5-coder:3b (für den Test gesetzt)
// Ablauf: Dashboard-Composer (Projekt + Coding-Modus) → Pending-Send → ChatView → Agent
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + String(extra).slice(0, 200) : ''}`); };

const FIXTURE = path.resolve('test/explorer-fixture');
const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
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
  setTimeout(() => rej(new Error('timeout ' + method)), 60000);
});
await send('Page.enable');
await send('Runtime.enable');
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || 'JS-Fehler' };
  return r.result?.result?.value;
};

// Dashboard-Composer: Projekt + Coding-Modus wählen
const setupRes = await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  if (!proj || !mode) return 'MISSING:' + { proj: !!proj, mode: !!mode };
  const opt = [...proj.options].find(o => o.value.includes('explorer-fixture'));
  if (!opt) return 'NO_PROJ_OPTION:' + [...proj.options].map(o => o.text).join('|');
  proj.value = opt.value;
  proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
check('Dashboard: Projekt + Coding-Modus gewählt', setupRes === 'OK', setupRes);
await sleep(600);

const setComposer = (text) => ev(`(() => {
  const ta = document.querySelector('.composer textarea');
  if (!ta) return 'NO_TA';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const ensureCodeMode = () => ev(`(() => {
  const sel = document.querySelector('.mode-select');
  if (sel && sel.value !== 'code') { sel.value = 'code'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  return sel ? sel.value : 'NO_MODE';
})()`);
const thinking = () => ev(`!!document.querySelector('.chat-wrap .typing') || [...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`);
const lastAssistant = () => ev(`(() => { const m = [...document.querySelectorAll('.msg.assistant .bubble')]; return m.length ? m[m.length-1].innerText : ''; })()`);
const waitIdle = async (timeout = 300000) => {
  const t0 = Date.now();
  await sleep(3000);
  while (Date.now() - t0 < timeout) {
    if (!(await thinking())) return true;
    await sleep(4000);
  }
  return false;
};
const fileContent = async (rel) => ev(`(async () => { try { return await window.studio.fs.readFile(${JSON.stringify(FIXTURE.replace(/\\/g, '\\\\'))} + '\\\\' + ${JSON.stringify(rel)}, 100000); } catch(e) { return 'ERR:' + e.message; } })()`);

// ---------- Test A: Datei erstellen ----------
console.log('\n--- Test A: Datei erstellen ---');
await setComposer('Erstelle eine Datei test-agent.txt mit dem Inhalt: AI Developer Studio funktioniert.');
check('Test A: Senden', (await clickSend()) === 'clicked');
await sleep(2500); // ChatView mountet + übernimmt Pending-Send
const aDone = await waitIdle(300000);
check('Test A: Agent abgeschlossen (kein Timeout)', aDone);
await sleep(1500);
const aContent = await fileContent('test-agent.txt');
check('Test A: test-agent.txt existiert mit Inhalt', typeof aContent === 'string' && aContent.includes('AI Developer Studio funktioniert'), String(aContent).slice(0, 150));
const aReply = await lastAssistant();
check('Test A: Antwort erwähnt Ergebnis', /erstellt|erstelle|geschrieben|test-agent|datei/i.test(aReply || ''), (aReply || '').slice(0, 200));

// ---------- Test B: Datei bearbeiten ----------
console.log('\n--- Test B: Datei bearbeiten ---');
await ensureCodeMode();
await setComposer('Ändere den Inhalt von test-agent.txt auf: Coding funktioniert.');
check('Test B: Senden', (await clickSend()) === 'clicked');
const bDone = await waitIdle(300000);
check('Test B: Agent abgeschlossen', bDone);
await sleep(1500);
const bContent = await fileContent('test-agent.txt');
check('Test B: Inhalt geändert', typeof bContent === 'string' && bContent.includes('Coding funktioniert'), String(bContent).slice(0, 150));

// ---------- Test C: Code suchen ----------
console.log('\n--- Test C: Funktion suchen ---');
await ensureCodeMode();
await setComposer('Suche in meinem Projekt die Funktion login und sage mir, in welcher Datei sie liegt.');
check('Test C: Senden', (await clickSend()) === 'clicked');
const cDone = await waitIdle(300000);
check('Test C: Agent abgeschlossen', cDone);
await sleep(1500);
const cReply = await lastAssistant();
check('Test C: Antwort nennt auth.js', /auth\.js/i.test(cReply || ''), (cReply || '').slice(0, 250));

// ---------- Test D: Konfiguration ändern ----------
console.log('\n--- Test D: Konfiguration ändern ---');
await ensureCodeMode();
await setComposer('Suche die Einstellung feedbackChannelId in meiner Konfiguration und ändere sie auf 1569408831300042793.');
check('Test D: Senden', (await clickSend()) === 'clicked');
const dDone = await waitIdle(300000);
check('Test D: Agent abgeschlossen', dDone);
await sleep(1500);
const dContent = await fileContent('config/settings.json');
check('Test D: feedbackChannelId geändert', typeof dContent === 'string' && dContent.includes('1569408831300042793'), String(dContent).slice(0, 250));
check('Test D: andere Einstellungen unverändert', typeof dContent === 'string' && dContent.includes('ticketCategoryId') && dContent.includes('Willkommen'), '');

console.log('\n=== ZUSAMMENFASSUNG ===');
const fails = results.filter(r => !r.ok);
console.log(`${results.length - fails.length}/${results.length} bestanden`);
fs.writeFileSync('test/coding-results.json', JSON.stringify(results, null, 2));
process.exit(fails.length ? 1 : 0);
