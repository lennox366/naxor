const L = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const p = L.find(t => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
const expr = `(async()=>{
  const out = {hasSR: !!(window.SpeechRecognition||window.webkitSpeechRecognition), mediaDevices: !!navigator.mediaDevices};
  try { const s = await navigator.mediaDevices.getUserMedia({audio:true}); out.mic='OK'; s.getTracks().forEach(t=>t.stop()); }
  catch(e){ out.mic='FEHLER: '+e.name+' '+e.message; }
  const Ctor = window.SpeechRecognition||window.webkitSpeechRecognition;
  if (Ctor) {
    const r = new Ctor(); r.lang='de-DE'; r.interimResults=true; r.continuous=false;
    out.srResult = await new Promise(res=>{
      const to=setTimeout(()=>res('TIMEOUT nach 8s (kein onend/onerror/onresult)'),8000);
      r.onresult=e=>{clearTimeout(to);res('RESULT: '+e.results[0][0].transcript)};
      r.onerror=e=>{clearTimeout(to);res('ERROR: '+e.error+' | '+e.message)};
      r.onend=()=>{clearTimeout(to);res('END ohne Ergebnis')};
      try{r.start()}catch(e){clearTimeout(to);res('START-THROW: '+e.message)}
    });
  }
  return JSON.stringify(out);
})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { console.log(m.result?.result?.value); process.exit(0); } };
setTimeout(() => { console.log('timeout'); process.exit(1); }, 25000);
