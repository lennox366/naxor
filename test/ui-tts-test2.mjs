const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('PAGE:', await val('document.querySelector(".page-title")?.textContent'));
console.log('BTNS:', await val(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/Stimme|Stopp|Speichern|testen/i.test(t))`));
console.log('ENGINE:', await val(`[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='elevenlabs'))?.value`));
// direkter Klick auf den Test-Button
console.log('CLICK:', await val(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/Stimme testen/.test(b.textContent)); if(!b) return 'kein Button'; b.click(); return 'geklickt: '+b.textContent.trim() })()`));
await sleep(3000);
console.log('STATUS-TEXT:', await val(`document.body.innerText.match(/(Fehler|Wiedergabe|lädt|Kein ElevenLabs)[^\\n]*/)?.[0] || 'nichts gefunden'`));
process.exit(0);
