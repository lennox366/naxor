// Live-Arbeitsanzeige + Diffs + Basis-Timing (vor Optimierung messbar)
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FIX = path.resolve('test/explorer-fixture');
const TESTFILE = path.join(FIX, 'live-test.txt');
fs.writeFileSync(TESTFILE, 'STATUS: ALT-LIVE\n');

const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };

const tSend = Date.now();
await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Neuer Chat'))?.click()`);
await sleep(1200);
await ev(`(() => {
  const proj = document.querySelector('.project-select');
  const mode = document.querySelector('.mode-select');
  const norm = s => s.replace(/\\\\/g, '/');
  const opt = [...proj.options].find(o => norm(o.value).endsWith('/explorer-fixture'));
  proj.value = opt.value; proj.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'code'; mode.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await ev(`(() => { const ta = document.querySelector('.composer textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, 'Lies die Datei live-test.txt und ändere den Inhalt: STATUS soll NEU-LIVE sein.'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
console.log('send:', await ev(`(() => { const b = document.querySelector('.send-btn'); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`), 't=', Date.now() - tSend, 'ms');

// Beobachte: erste sichtbare Agent-Aktivität + Abschluss
let firstActivity = null, done = false, domOk = null;
const t0 = Date.now();
while (Date.now() - t0 < 480000) {
  if (!firstActivity) {
    const has = await ev(`!!document.querySelector('.agent-activity')`);
    if (has) { firstActivity = Date.now() - tSend; console.log('ERSTE .agent-activity sichtbar nach', firstActivity, 'ms'); }
  }
  const status = await ev(`(() => {
    const msgs = [...document.querySelectorAll('.msg.assistant .bubble')];
    const last = msgs[msgs.length - 1];
    const aa = last?.querySelector('.agent-activity');
    return { hasAA: !!aa, groups: aa?.querySelectorAll('.aa-group').length || 0, steps: aa?.querySelectorAll('.aa-step').length || 0, thinking: !!document.querySelector('.typing, .is-thinking, [class*=thinking]') };
  })()`);
  if (status?.groups > 0) {
    domOk = status;
    // Datei-Inhalt prüfen
    const content = fs.existsSync(TESTFILE) ? fs.readFileSync(TESTFILE, 'utf8') : '';
    if (content.includes('NEU-LIVE')) { done = true; break; }
  }
  await sleep(4000);
}
console.log('DOM:', JSON.stringify(domOk), 'datei NEU-LIVE:', done, 'gesamt', Date.now() - tSend, 'ms');

// Meta/Events aus DB-Nachricht prüfen (letzte assistant-Nachricht)
const metaInfo = await ev(`(async () => {
  const res = await window.studio?.db?.query?.("SELECT meta FROM messages WHERE role='assistant' ORDER BY created_at DESC LIMIT 1");
  return res;
})()`);
console.log('meta via IPC:', JSON.stringify(metaInfo).slice(0, 300));

// Events aufklappen: filediff suchen und DiffView prüfen
const diffTest = await ev(`(() => {
  const steps = [...document.querySelectorAll('.aa-step')];
  const diffStep = steps.find(s => s.innerText.includes('Änderung gespeichert') || s.innerText.includes('live-test'));
  if (!diffStep) return 'NO_DIFF_STEP';
  diffStep.querySelector('.aa-step-head')?.click();
  return 'clicked';
})()`);
await sleep(800);
const diffView = await ev(`(() => {
  const dv = document.querySelector('.aa-step-body .diff-view, .aa-step-body [class*=diff], .aa-step-body');
  const rows = document.querySelectorAll('.aa-step-body > div > div, .aa-step-body pre');
  return { found: !!dv, text: dv?.innerText?.slice(0, 200) || null, preCount: document.querySelectorAll('.aa-step-body pre').length };
})()`);
console.log('diffStep:', diffTest, 'diffView:', JSON.stringify(diffView).slice(0, 400));
process.exit(0);
