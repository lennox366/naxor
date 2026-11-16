// Branding- + TTS-Integrationstest für „230% Offiziell"
const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0;
const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;

console.log('TITLE:', await val('document.title'));
console.log('TOPBAR:', await val('document.querySelector(".brand-mini .t1")?.textContent'));
// Settings öffnen
await val(`(() => { const btns=[...document.querySelectorAll('button, a, [role=button], .nav-item, li, div')]; const b=btns.find(x=>/Einstellungen|Settings/i.test(x.textContent)&&x.textContent.length<30); if(b){b.click();return 'clicked '+b.textContent.trim().slice(0,30)} return 'notfound' })()`);
await new Promise(r => setTimeout(r, 1200));
console.log('PAGE:', await val('document.querySelector(".page-title")?.textContent'));
console.log('ENGINE-SELECT:', await val(`[...document.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.textContent)).flat().join(' | ')`));
console.log('ELEVEN-FIELDS:', await val(`({key:!![...document.querySelectorAll('input[type=password]')].find(i=>i.placeholder&&i.placeholder.includes('xi-api')), vid:[...document.querySelectorAll('input')].find(i=>i.value&&i.value.includes('lzfd'))?.value||'', vol:[...document.querySelectorAll('input[type=range]')].length, testBtn:[...document.querySelectorAll('button')].some(b=>/Stimme testen/.test(b.textContent))})`));
console.log('ABOUT:', await val(`[...document.querySelectorAll('*')].map(e=>e.childNodes.length===1&&e.textContent.includes('230% Offiziell v')?e.textContent.trim():null).find(Boolean)`));
process.exit(0);
