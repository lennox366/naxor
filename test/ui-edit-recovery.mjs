// Recovery-Test: absichtlich falscher alter Wert → Agent muss Fehler erkennen,
// Datei lesen, mit tatsächlichem Inhalt erneut versuchen. Kein falscher Erfolg.
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
  const opt = [...proj.options].find(o => o.value.includes('explorer-fixture'));
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`);
console.log('setup:', setup);

const setComposer = (t) => ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const clickSend = () => ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const thinking = () => ev(`!!document.querySelector('.chat-wrap .typing') || [...document.querySelectorAll('button')].some(b => b.innerText.includes('Stopp'))`);
const waitIdle = async (timeout = 420000) => { const t0 = Date.now(); await sleep(5000); while (Date.now() - t0 < timeout) { if (!(await thinking())) { await sleep(3000); if (!(await thinking())) return true; } await sleep(5000); } return false; };
const fileContent = async (rel) => { try { return fs.readFileSync(path.join(FIXTURE, rel), 'utf8'); } catch (e) { return 'ERR:' + e.message; } };
const lastAssistant = () => ev(`(() => { const m = [...document.querySelectorAll('.msg.assistant .bubble')]; return m.length ? m[m.length-1].innerText : ''; })()`);
const jsonValid = (c) => { try { JSON.parse(c); return true; } catch { return false; } };

console.log('\n=== RECOVERY: falscher alter Wert ALT-FALSCH-999 ===');
await setComposer('In config/settings.json ersetze den Wert ALT-FALSCH-999 der Einstellung welcomeMessage durch Hallo Welt.');
console.log('send:', await clickSend());
console.log('idle:', await waitIdle());
await sleep(2500);
const s = await fileContent('config/settings.json');
console.log('settings.json:', s);
console.log('JSON gültig:', jsonValid(s));
console.log('welcomeMessage = Hallo Welt:', s.includes('Hallo Welt'));
console.log('feedbackChannelId unverändert:', s.includes('1569408831300042793'));
console.log('reply:', (await lastAssistant())?.slice(0, 2500));
process.exit(0);
