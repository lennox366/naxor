// Test: Zuverlässige Dateiänderungen — Read-first, old_text-Fehler-Recovery,
// JSON-Validierung, kein falscher Erfolg.
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FIXTURE = path.resolve('test/explorer-fixture');

const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout')), 60000); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };

await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`);
await sleep(1000);

const setup = await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  if (!proj || !mode) return 'MISSING';
  const opt = [...proj.options].find(o => o.value.includes('explorer-fixture'));
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
console.log('setup:', setup);

const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const thinking = () => ev(`!!document.querySelector('.chat-wrap .typing') || [...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`);
const waitIdle = async (timeout = 300000) => { const t0 = Date.now(); await sleep(3000); while (Date.now() - t0 < timeout) { if (!(await thinking())) return true; await sleep(4000); } return false; };
const fileContent = async (rel) => { try { return fs.readFileSync(path.join(FIXTURE, rel), 'utf8'); } catch (e) { return 'ERR:' + e.message; } };
const lastAssistant = () => ev(`(() => { const m = [...document.querySelectorAll('.msg.assistant .bubble')]; return m.length ? m[m.length-1].innerText : ''; })()`);
const jsonValid = (c) => { try { JSON.parse(c); return true; } catch { return false; } };

// ---------- Test 1: feedbackChannelId ändern ----------
console.log('\n=== TEST 1: feedbackChannelId → 1569408831300042793 ===');
await setComposer('Suche die Einstellung feedbackChannelId in meiner Konfiguration und ändere sie auf 1569408831300042793.');
console.log('send:', await clickSend());
console.log('idle:', await waitIdle());
await sleep(2000);
const s1 = await fileContent('config/settings.json');
console.log('settings.json:', s1);
console.log('JSON gültig:', jsonValid(s1));
console.log('neuer Wert drin:', s1.includes('1569408831300042793'));
console.log('alter Wert weg:', !s1.includes('1000000000000000001'));
console.log('reply:', (await lastAssistant())?.slice(0, 1200));

// ---------- Test 2: absichtlich falscher old_text → Recovery ----------
console.log('\n=== TEST 2: falscher alter Wert → Recovery ===');
await setComposer('In config/settings.json ersetze den Wert ALT-FALSCH-999 der Einstellung welcomeMessage durch Hallo Welt.');
console.log('send:', await clickSend());
console.log('idle:', await waitIdle());
await sleep(2000);
const s2 = await fileContent('config/settings.json');
console.log('settings.json:', s2);
console.log('JSON gültig:', jsonValid(s2));
console.log('welcomeMessage geändert:', s2.includes('Hallo Welt'));
console.log('reply:', (await lastAssistant())?.slice(0, 1500));
process.exit(0);
