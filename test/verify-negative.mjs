// Deterministische Negativ-/Positivtests für buildVerificationReport.
// Prüft: kein Erfolg ohne echten erfolgreichen Werkzeugaufruf in DIESEM Auftrag.
globalThis.window = { studio: { fs: { exists: async () => false } } };
const { buildVerificationReport } = await import('./agent.bundle.mjs');

const mk = (over) => ({
  id: 'a1-c1', auftragId: 'a1', command: 'python test.py', code: 0, ts: Date.now(), ...over,
});
const ev = () => {};
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };

// 1) Kein Befehl → nicht ausgeführt
let r = await buildVerificationReport('x', new Set(), [], ev, undefined, 'a1');
check('keine Befehle → Nicht ausgeführt', r.includes('Nicht ausgeführt'));
check('keine Befehle → kein Bestanden', !r.includes('Bestanden'));

// 2) Alter Erfolg + leerer aktueller Auftrag → darf nicht durchrutschen
//    (cmdLog ist pro Auftrag neu; Test simuliert: nur alter Datensatz gehört nicht rein)
r = await buildVerificationReport('x', new Set(), [], ev, undefined, 'aNEU');
check('neuer Auftrag ohne Befehle → Nicht ausgeführt', r.includes('Nicht ausgeführt'));

// 3) Exit-Code 1 → Fehlgeschlagen
r = await buildVerificationReport('x', new Set(), [mk({ code: 1, stderr: 'boom' })], ev, undefined, 'a1');
check('exit 1 → Fehlgeschlagen', r.includes('Fehlgeschlagen'));
check('exit 1 → stderr protokolliert', r.includes('boom'));

// 4) Abgebrochen → kein Erfolg
r = await buildVerificationReport('x', new Set(), [mk({ code: -1, killed: true })], ev, undefined, 'a1');
check('abgebrochen → Fehlgeschlagen (nicht Bestanden)', r.includes('Fehlgeschlagen') && !r.includes('Bestanden'));

// 5) Timeout → kein Erfolg
r = await buildVerificationReport('x', new Set(), [mk({ code: -1, timedOut: true })], ev, undefined, 'a1');
check('timeout → Fehlgeschlagen', r.includes('Fehlgeschlagen'));

// 6) Nur Auto-Syntaxcheck → NICHT als Funktionstest bestanden
r = await buildVerificationReport('x', new Set(['f.py']), [mk({ auto: true, command: 'python -m py_compile "f.py"', code: 0 })], ev, undefined, 'a1');
check('nur Syntaxcheck → kein Funktionstest', r.includes('Kein Funktionstest'));
check('Syntaxcheck als solcher gekennzeichnet', r.includes('Syntaxprüfung'));

// 7) Beliebiger erfolgreicher Befehl (kein Test-Muster) → kein Funktionstest
r = await buildVerificationReport('x', new Set(), [mk({ command: 'dir', code: 0 })], ev, undefined, 'a1');
check('dir exit 0 → kein Funktionstest', r.includes('Kein Funktionstest'));

// 8) Echter Python-Funktionstest bestanden
r = await buildVerificationReport('x', new Set(), [mk({ command: 'python rechner.py', code: 0, stdout: '12' })], ev, undefined, 'a1');
check('python-Skript exit 0 → Funktionstest bestanden', r.includes('Funktionstest bestanden'));

// 9) npm test exit 0 → Funktionstest
r = await buildVerificationReport('x', new Set(), [mk({ command: 'npm test', code: 0 })], ev, undefined, 'a1');
check('npm test → Funktionstest bestanden', r.includes('Funktionstest bestanden'));

// 10) IDs/Zeitstempel/stdout im Bericht
r = await buildVerificationReport('x', new Set(), [mk({ command: 'node -e "1"', code: 0, stdout: 'hello', id: 'a1-c7' })], ev, undefined, 'a1');
check('Befehls-ID im Bericht', r.includes('a1-c7'));
check('stdout im Bericht', r.includes('hello'));
check('Auftrags-ID im Bericht', r.includes('a1'));

// 11) Exit 0 + verfehlte Erwartung → TROTDEM Fehlgeschlagen
r = await buildVerificationReport('x', new Set(), [mk({ command: 'node math.js', code: 0, stdout: '42\n81', expect: '99', expectMet: false })], ev, undefined, 'a1');
check('exit 0 + Erwartung verfehlt → Fehlgeschlagen', r.includes('Fehlgeschlagen'));
check('Erwartung im Bericht markiert', r.includes('verfehlt'));

// 12) Exit 0 + erfüllte Erwartung → bestanden MIT Hinweis auf Assertierung
r = await buildVerificationReport('x', new Set(), [mk({ command: 'node math.js', code: 0, stdout: '42\n81', expect: '42', expectMet: true })], ev, undefined, 'a1');
check('exit 0 + Erwartung erfüllt → bestanden', r.includes('bestanden'));
check('assertierter Test erkannt', r.includes('erwarteter Ausgabe'));

// 13) Erwartung nicht prüfbar (expect undefined) → normaler exit-0-Test
r = await buildVerificationReport('x', new Set(), [mk({ command: 'node math.js', code: 0, stdout: '42' })], ev, undefined, 'a1');
check('exit 0 ohne Erwartung → bestanden (nicht assertiert)', r.includes('nicht assertiert'));

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
