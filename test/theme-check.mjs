const L = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const p = L.find(t => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:`JSON.stringify({
  title: document.title,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  hasLogo: !!document.querySelector('.naxora-logo'),
  themeCss: [...document.styleSheets].map(s=>s.href).filter(Boolean).length,
  sidebarBtns: document.querySelectorAll('aside button, .sidebar button').length,
  bodyClasses: document.body.className
})`, returnByValue: true}}));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id===1) { console.log(m.result?.result?.value); process.exit(0); } };
setTimeout(() => process.exit(1), 10000);
