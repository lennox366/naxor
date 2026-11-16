const LIST = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = LIST.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let idc = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const ev = (expression) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
const val = async (expr) => (await ev(expr)).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sidebar-Nav: alle klickbaren Elemente mit Text 'Einstellungen'
console.log('NAV:', await val(`(() => {
  const cands=[...document.querySelectorAll('button,div,li,a,span')].filter(e=>e.textContent.trim()==='Einstellungen');
  const info=cands.map(e=>e.tagName+'.'+e.className).slice(0,5);
  const b=cands.map(e=>e.closest('button,[role=button],li,.nav-item,div[class*=item],div[class*=nav]')||e).find(Boolean);
  b?.click();
  return JSON.stringify({found:cands.length, info, clicked:!!b});
})()`));
await sleep(1500);
console.log('PAGE:', await val('document.querySelector(".page-title")?.textContent'));
console.log('ENGINE:', await val(`[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='elevenlabs'))?.value`));
console.log('CLICK:', await val(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/Stimme testen/.test(b.textContent)); if(!b) return 'kein Button'; b.click(); return 'geklickt' })()`));
await sleep(3000);
console.log('STATUS:', await val(`document.body.innerText.match(/(Fehler:|Wiedergabe beendet|lädt|Kein ElevenLabs)[^\\n]*/)?.[0] || document.querySelector('.glass-card:nth-of-type(2)')?.innerText?.slice(-200) || 'nichts'`));
process.exit(0);
