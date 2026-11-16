// CDP-Test: Coding-Studio Datei-Explorer (hierarchisch, VS-Code-Stil)
// Fixture: test/explorer-fixture (commands/, events/, config/, database/, deep/a/b/c/)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(t => t.type === 'page');
if (!page) { console.error('Keine Page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error('timeout ' + method)), 30000);
});
await send('Page.enable');
await send('Runtime.enable');
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || 'JS-Fehler' };
  return r.result?.result?.value;
};
const waitFor = async (expr, timeout = 20000, poll = 800) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await ev(expr);
    if (v) return v;
    await sleep(poll);
  }
  return null;
};

// 1) Coding Studio öffnen
await ev(`[...document.querySelectorAll('.nav-item')].find(b => b.innerText.includes('Coding Studio'))?.click()`);
await sleep(800);
check('Coding-Studio geöffnet', await ev(`!!document.querySelector('.cs-tree')`));

// 2) Fixture-Projekt wählen (NICHT projects[0] — das ist der Bot!)
const FIXTURE = 'C:\\\\Users\\\\User\\\\Desktop\\\\tasten\\\\Code KI alles\\\\test\\\\explorer-fixture';
const selRes = await ev(`(() => {
  const sel = document.querySelector('.view select');
  if (!sel) return 'NO_SELECT';
  const opt = [...sel.options].find(o => o.text.includes('explorer-fixture'));
  if (!opt) return 'NO_OPTION:' + [...sel.options].map(o => o.text).join('|');
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK:' + opt.value;
})()`);
check('Fixture-Projekt wählbar', String(selRes).startsWith('OK'), String(selRes).slice(0, 120));
await waitFor(`document.querySelectorAll('.cs-tree .fi').length > 3`, 15000);
await sleep(600);

// 3) Baum-Inhalt: erwartete Einträge vorhanden
const names = await ev(`(() => [...document.querySelectorAll('.cs-tree .fi .cs-name')].map(e => e.innerText))()`);
check('Root-Dateien index.js + package.json', names?.includes('index.js') && names?.includes('package.json'), JSON.stringify(names));
check('Ordner commands/events/config/database/deep', ['commands','events','config','database','deep'].every(d => names?.includes(d)));

// 4) Hierarchie: Kind-Indizes unter commands
const struct = await ev(`(() => {
  const rows = [...document.querySelectorAll('.cs-tree .fi')];
  const out = {};
  for (const r of rows) {
    const nm = r.querySelector('.cs-name')?.innerText;
    const pad = parseInt(r.style.paddingLeft || '0');
    out[nm] = pad;
  }
  return out;
})()`);
check('commands.gang.js eingerückt (tiefer als commands)', (struct?.['gang.js'] ?? 0) > (struct?.['commands'] ?? 999), JSON.stringify({commands: struct?.commands, gang: struct?.['gang.js'], index: struct?.['index.js']}));

// 5) Collapse/Expand: commands zuklappen → Kinder verschwinden
const collapseTest = await ev(`(async () => {
  const rows = [...document.querySelectorAll('.cs-tree .fi')];
  const cmd = rows.find(r => r.querySelector('.cs-name')?.innerText === 'commands');
  if (!cmd) return 'NO_CMD';
  cmd.click(); await new Promise(r => setTimeout(r, 300));
  const gangVisible = [...document.querySelectorAll('.cs-tree .fi .cs-name')].some(e => e.innerText === 'gang.js');
  cmd.click(); await new Promise(r => setTimeout(r, 300));
  const gangBack = [...document.querySelectorAll('.cs-tree .fi .cs-name')].some(e => e.innerText === 'gang.js');
  return JSON.stringify({ gangVisibleAfterCollapse: gangVisible, gangBackAfterExpand: gangBack });
})()`);
const ct = JSON.parse(collapseTest || '{}');
check('Ordner zugeklappt → Kinder weg', ct.gangVisibleAfterCollapse === false);
check('Ordner aufgeklappt → Kinder zurück', ct.gangBackAfterExpand === true);

// 6) Tief verschachtelt: deep/a/b/c/tief.txt sichtbar (default expanded)
const tiefVisible = await ev(`[...document.querySelectorAll('.cs-tree .fi .cs-name')].some(e => e.innerText === 'tief.txt')`);
check('Tief-Datei tief.txt sichtbar (deep/a/b/c)', tiefVisible === true);

// 7) Collapse von 'a' versteckt tief.txt
const deepTest = await ev(`(async () => {
  const rows = [...document.querySelectorAll('.cs-tree .fi')];
  const a = rows.find(r => r.querySelector('.cs-name')?.innerText === 'a' && r.querySelector('.cs-ico.dir'));
  if (!a) return 'NO_A';
  a.click(); await new Promise(r => setTimeout(r, 300));
  const hidden = ![...document.querySelectorAll('.cs-tree .fi .cs-name')].some(e => e.innerText === 'tief.txt');
  a.click(); await new Promise(r => setTimeout(r, 300));
  const back = [...document.querySelectorAll('.cs-tree .fi .cs-name')].some(e => e.innerText === 'tief.txt');
  return JSON.stringify({ hidden, back });
})()`);
const dt = JSON.parse(deepTest || '{}');
check('Verschachtelter Ordner a zugeklappt → tief.txt weg', dt.hidden === true);
check('a wieder aufgeklappt → tief.txt zurück', dt.back === true);

// 8) Datei öffnen: index.js → Editor + .sel
const openTest = await ev(`(async () => {
  const rows = [...document.querySelectorAll('.cs-tree .fi')];
  const f = rows.find(r => r.querySelector('.cs-name')?.innerText === 'index.js' && !r.querySelector('.cs-ico.dir'));
  if (!f) return 'NO_FILE';
  f.click(); await new Promise(r => setTimeout(r, 800));
  const ta = document.querySelector('.editor textarea, textarea.editor, .code-editor textarea') || [...document.querySelectorAll('textarea')].find(t => t.offsetParent && t.value.includes('console.log'));
  const sel = f.classList.contains('sel');
  return JSON.stringify({ opened: !!ta, sel, hasConsole: (ta?.value || '').includes('console.log') });
})()`);
const ot = JSON.parse(openTest || '{}');
check('index.js geöffnet (Editor-Inhalt console.log)', ot.opened && ot.hasConsole, JSON.stringify(ot));
check('Geöffnete Datei markiert (.sel)', ot.sel === true);

// 9) Wechsel auf package.json → Markierung wandert
const switchTest = await ev(`(async () => {
  const rows = [...document.querySelectorAll('.cs-tree .fi')];
  const f = rows.find(r => r.querySelector('.cs-name')?.innerText === 'package.json' && !r.querySelector('.cs-ico.dir'));
  if (!f) return 'NO_FILE';
  f.click(); await new Promise(r => setTimeout(r, 800));
  const selName = [...document.querySelectorAll('.cs-tree .fi.sel .cs-name')].map(e => e.innerText);
  return JSON.stringify({ selName });
})()`);
const st = JSON.parse(switchTest || '{}');
check('Dateiwechsel: package.json markiert', st.selName?.includes('package.json'), JSON.stringify(st));

// 10) Neue Datei über Inline-Input erstellen
const createFile = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.title === 'Neue Datei');
  if (!btn) return 'NO_BTN';
  btn.click(); await new Promise(r => setTimeout(r, 300));
  const inp = document.querySelector('.cs-create input');
  if (!inp) return 'NO_INPUT';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inp, 'neu/erstellte-testdatei.txt');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
  const names = [...document.querySelectorAll('.cs-tree .fi .cs-name')].map(e => e.innerText);
  const has = names.includes('erstellte-testdatei.txt');
  const opened = [...document.querySelectorAll('textarea')].some(t => t.value.includes('neu'));
  return JSON.stringify({ has, opened });
})()`);
const cf = JSON.parse(createFile || '{}');
check('Neue Datei im Baum an richtiger Stelle (neu/)', cf.has === true, JSON.stringify(cf));

// 11) Neuer Ordner über Inline-Input
const createDir = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.title === 'Neuer Ordner');
  if (!btn) return 'NO_BTN';
  btn.click(); await new Promise(r => setTimeout(r, 300));
  const inp = document.querySelector('.cs-create input');
  if (!inp) return 'NO_INPUT';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inp, 'neu/unterordner');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
  const names = [...document.querySelectorAll('.cs-tree .fi .cs-name')].map(e => e.innerText);
  return JSON.stringify({ has: names.includes('unterordner') });
})()`);
const cd = JSON.parse(createDir || '{}');
check('Neuer Ordner im Baum (neu/unterordner)', cd.has === true, JSON.stringify(cd));

// 12) Keine doppelten Einträge
const dupCheck = await ev(`(() => {
  const names = [...document.querySelectorAll('.cs-tree .fi .cs-name')].map(e => e.innerText);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  return JSON.stringify({ total: names.length, dups: [...new Set(dup)] });
})()`);
const dc = JSON.parse(dupCheck || '{}');
check('Keine doppelten Dateieinträge', (dc.dups || []).length === 0, JSON.stringify(dc));

// Dateisystem-Verifikation der erstellten Dateien
const fsCheck = await ev(`(async () => {
  const root = 'C:\\\\Users\\\\User\\\\Desktop\\\\tasten\\\\Code KI alles\\\\test\\\\explorer-fixture';
  const f1 = await window.studio.fs.exists(root, 'neu/erstellte-testdatei.txt');
  const f2 = await window.studio.fs.exists(root, 'neu/unterordner');
  return JSON.stringify({ file: f1, dir: f2 });
})()`);
const fc = JSON.parse(fsCheck || '{}');
check('Datei + Ordner wirklich auf Platte', fc.file === true && fc.dir === true, JSON.stringify(fc));

console.log('\n=== ZUSAMMENFASSUNG ===');
const fails = results.filter(r => !r.ok);
console.log(`${results.length - fails.length}/${results.length} bestanden`);
if (fails.length) fails.forEach(f => console.log('FEHLER:', f.name, f.extra));
process.exit(fails.length ? 1 : 0);
