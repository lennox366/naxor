const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;

// zur Settings-Seite navigieren
await val(`(() => { const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()==='Einstellungen'); const b=els[0]?.closest('button,div[role=button],li,a')||els[0]; b?.click(); return els.length })()`);
await new Promise(r => setTimeout(r, 1200));
// TTS-Engine-Select auf elevenlabs schalten und Felder lesen
console.log(await val(`(() => {
  const sels=[...document.querySelectorAll('select')];
  const tts=sels.find(s=>[...s.options].some(o=>o.value==='elevenlabs'));
  if(!tts) return 'kein TTS-Select';
  const out={engineBefore:tts.value};
  const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
  setter.call(tts,'elevenlabs'); tts.dispatchEvent(new Event('change',{bubbles:true}));
  return new Promise(r=>setTimeout(()=>{
    const pw=[...document.querySelectorAll('input[type=password]')].find(i=>i.placeholder&&i.placeholder.includes('xi-api'));
    const vid=[...document.querySelectorAll('input')].map(i=>i.value).find(v=>v&&v.length>10);
    r(JSON.stringify({...out, keyLen: pw?pw.value.length:-1, vid: vid||'', hasTest:[...document.querySelectorAll('button')].some(b=>/Stimme testen/.test(b.textContent))}));
  },500));
})()`));
process.exit(0);
