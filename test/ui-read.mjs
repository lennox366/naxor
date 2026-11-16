// Liest den aktuellen Chat-Inhalt nach等待 (für laufende Antworten).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const wait = +(process.argv[2] || 60);
await sleep(wait * 1000);
console.log(await ev(`document.body.innerText.slice(-3500)`));
ws.close(); process.exit(0);
