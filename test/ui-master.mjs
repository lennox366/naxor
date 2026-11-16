const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clickNav = async (label) => val(`(() => { const els=[...document.querySelectorAll('button.nav-item, .nav-item, button, li')].filter(e=>e.textContent.trim()==='${label}'); const b=els[0]; b?.click(); return !!b })()`);

// Design Studio
await clickNav('Design Studio'); await sleep(1200);
console.log('DS-PRESETS:', await val(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/Dashboard|Admin|Website|Login|Statistik|Gaming/.test(t)).join(', ')`));
console.log('DS-TITLE:', await val('document.querySelector(".page-title")?.textContent'));

// Settings: Mikrofon + AutoSpeak + Bild-Provider
await clickNav('Einstellungen'); await sleep(1500);
console.log('MIC-SELECT:', await val(`(() => { const sels=[...document.querySelectorAll('select')]; const m=sels.find(s=>[...s.options].some(o=>o.textContent.includes('Standardgerät'))); return m ? [...m.options].map(o=>o.textContent).join('|') : 'nicht gefunden' })()`));
console.log('AUTOSPEAK:', await val(`[...document.querySelectorAll('input[type=checkbox]')].length + ' Checkbox(en)'`));
console.log('IMG-FIELDS:', await val(`(() => { const ins=[...document.querySelectorAll('input')]; return {ep: ins.some(i=>i.placeholder&&i.placeholder.includes('Pollinations')), key: ins.filter(i=>i.type==='password').length} })()`));
console.log('MIC-TEST-BTN:', await val(`[...document.querySelectorAll('button')].some(b=>/Pegeltest/.test(b.textContent))`));
process.exit(0);
