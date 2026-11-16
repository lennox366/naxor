const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await val(`(() => { const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()==='Einstellungen'); (els[0]?.closest('button,div[role=button],li,a')||els[0])?.click(); return 1 })()`);
await sleep(1200);
await val(`(() => { const tts=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='elevenlabs')); if(!tts) return 0; const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set; setter.call(tts,'elevenlabs'); tts.dispatchEvent(new Event('change',{bubbles:true})); return 1 })()`);
await sleep(500);
await val(`[...document.querySelectorAll('button')].find(b=>/Stimme testen/.test(b.textContent))?.click()`);
await sleep(2500);
console.log('TESTSTATUS:', await val(`[...document.querySelectorAll('span,div')].map(e=>e.textContent.trim()).find(t=>/Fehler:|Wiedergabe|lädt/.test(t)&&t.length<200)`));
process.exit(0);
