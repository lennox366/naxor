const L = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const p = L.find(t => t.type === 'page');
if (!p) { console.log('kein page-target'); process.exit(1); }
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
const expr = `(()=>{
  try{speechSynthesis.cancel()}catch(e){}
  document.querySelectorAll('audio').forEach(a=>{try{a.pause();a.removeAttribute('src');a.load()}catch(e){}});
  return 'stopped';
})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { console.log(m.result?.result?.value); process.exit(0); } };
setTimeout(() => process.exit(1), 8000);
