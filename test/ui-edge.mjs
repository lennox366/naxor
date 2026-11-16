const L = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const p = L.find(t => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
const expr = `(async()=>{const r=await window.studio.tts.edge({text:'Hallo, dies ist ein Test mit einer völlig neuen deutschen Sentenz, die so nicht in der Aufnahme steht.',voice:'de-DE-KatjaNeural'});return JSON.stringify({ok:r.ok,b64len:r.audioBase64?r.audioBase64.length:0,err:r.error,online:r.online})})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { console.log(m.result?.result?.value); process.exit(0); } };
setTimeout(() => { console.log('timeout'); process.exit(1); }, 30000);
