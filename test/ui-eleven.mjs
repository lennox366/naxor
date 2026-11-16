const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;

// Engine auf elevenlabs umstellen (React-Select simulieren)
console.log('SWITCH:', await val(`(() => { const sels=[...document.querySelectorAll('select')]; const tts=sels.find(s=>[...s.options].some(o=>o.value==='elevenlabs')); if(!tts) return 'select nicht gefunden'; const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set; setter.call(tts,'elevenlabs'); tts.dispatchEvent(new Event('change',{bubbles:true})); return 'ok' })()`));
await new Promise(r => setTimeout(r, 600));
console.log('FIELDS:', await val(`({keyInput:[...document.querySelectorAll('input[type=password]')].map(i=>i.placeholder), vid:[...document.querySelectorAll('input')].map(i=>i.value).find(v=>v&&v.includes('lzfd')), testBtn:[...document.querySelectorAll('button')].some(b=>/Stimme testen/.test(b.textContent))})`));
// Fehlermeldung bei fehlendem Key direkt über speech.ts-Pfad testen
console.log('TTS-ERR:', await val(`(async()=>{ const m=await import('/src/services/speech.ts').catch(()=>null); return m? 'modul':'kein-direktimport' })()`));
// Direkter IPC-Test: tts:elevenlabs ohne Key → verständlicher Fehler
console.log('IPC:', await val(`(async()=>{ try{ const r=await window.studio.tts.elevenlabs({text:'Hallo',apiKey:'',voiceId:'lzfdHZ2QD3sqy4zwTwi2'}); return JSON.stringify(r) }catch(e){ return 'throw:'+e.message } })()`));
console.log('IPC-BADKEY:', await val(`(async()=>{ try{ const r=await window.studio.tts.elevenlabs({text:'Hallo',apiKey:'sk_test_invalid',voiceId:'lzfdHZ2QD3sqy4zwTwi2'}); return JSON.stringify(r).slice(0,300) }catch(e){ return 'throw:'+e.message } })()`));
process.exit(0);
