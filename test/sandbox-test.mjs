// Deterministischer Sandbox-Test: Kopie, Konflikt, Apply, Discard.
// Prüft: Original unverändert bis Apply; extern geänderte Originale → Konflikt,
// keine stillschweigende Überschreibung.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';

const PROJ = path.resolve('test-projekt/sandbox-conflict');
const FILES = path.resolve('test-projekt/.backups');
await fs.rm(PROJ, { recursive: true, force: true });
await fs.mkdir(PROJ, { recursive: true });
await fs.mkdir(FILES, { recursive: true });

// Testdateien im "Original"
await fs.writeFile(path.join(PROJ, 'a.txt'), 'original-a');
await fs.writeFile(path.join(PROJ, 'b.txt'), 'original-b');
await fs.mkdir(path.join(PROJ, 'sub'), { recursive: true });
await fs.writeFile(path.join(PROJ, 'sub', 'c.txt'), 'original-c');

const safeJoin = (root, rel) => {
  const p = path.resolve(root, String(rel || '.'));
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Pfad außerhalb: ' + rel);
  return p;
};
const skip = new Set(['node_modules', '.git', 'dist', '.aistudio']);
const studio = {
  app: { paths: async () => ({ userData: FILES, filesDir: FILES, dbPath: FILES + '/db' }) },
  fs: {
    readDir: async (dir) => (await fs.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.')).map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dir, e.name) })),
    readFile: async (p, max = 2e6) => { const st = await fss.statSync(p); if (st.size > max) throw new Error('groß'); return fs.readFile(p, 'utf8'); },
    writeFile: async (p, c) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, c, 'utf8'); return true; },
    deletePath: async (root, rel) => { await fs.rm(safeJoin(root, rel), { recursive: true }); return true; },
    mkdir: async (root, rel) => { await fs.mkdir(safeJoin(root, rel || '.'), { recursive: true }); return true; },
    exists: async (root, rel) => { try { await fs.access(safeJoin(root, rel)); return true; } catch { return false; } },
    stat: async (root, rel) => { const st = await fss.statSync(safeJoin(root, rel)); return { size: st.size, isDir: st.isDirectory(), mtime: st.mtimeMs }; },
    listTree: async (root) => {
      const out = [];
      async function walk(dir, d) {
        if (d > 10) return;
        for (const en of await fs.readdir(dir, { withFileTypes: true })) {
          if (en.name.startsWith('.') || skip.has(en.name)) continue;
          const p = path.join(dir, en.name);
          out.push({ name: en.name, path: p, isDir: en.isDirectory(), depth: d });
          if (en.isDirectory()) await walk(p, d + 1);
        }
      }
      await walk(path.resolve(root), 0);
      return out;
    },
    renamePath: async () => {},
  },
  term: { run: async () => ({ code: 0, stdout: '', stderr: '' }), kill: async () => false },
};
globalThis.window = { studio };
const { createSandboxCopy, applySandboxChanges, discardSandbox } = await import('./agent.bundle.mjs');

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n); } };

// 1) Kopie erstellen
const sb = await createSandboxCopy(PROJ);
check('Sandbox erstellt', !!sb);
check('Manifest geschrieben', fss.existsSync(sb + '.manifest.json'));
// Agent simuliert Änderungen in der Kopie
await fs.writeFile(path.join(sb, 'a.txt'), 'geändert-durch-agent');
await fs.writeFile(path.join(sb, 'neu.txt'), 'neu von agent');
await fs.writeFile(path.join(sb, 'sub', 'c.txt'), 'sub geändert');

// Original nach Kopie EXTERN ändern (Konflikt!)
await fs.writeFile(path.join(PROJ, 'b.txt'), 'extern-geändert');
// b.txt wurde vom Agenten nicht angefasst → kein Konflikt erwartet.
// a.txt: Agent änderte es, Original unverändert → normal anwendbar.
// sub/c.txt: Agent änderte es → anwendbar.

// 2) Apply
const res = await applySandboxChanges(PROJ, sb, ['a.txt', 'b.txt', 'neu.txt', 'sub/c.txt']);
check('a.txt übernommen', res.applied.includes('a.txt'));
check('neu.txt übernommen', res.applied.includes('neu.txt'));
check('sub/c.txt übernommen', res.applied.includes('sub/c.txt'));
check('a.txt Inhalt im Original', (await fs.readFile(path.join(PROJ, 'a.txt'), 'utf8')) === 'geändert-durch-agent');
check('b.txt extern erhalten (nicht in changed → unberührt)', (await fs.readFile(path.join(PROJ, 'b.txt'), 'utf8')) === 'extern-geändert');

// 3) Echter Konflikt: extern ändern NACHDEM Apply, nochmal Sandbox-Flow
const sb2 = await createSandboxCopy(PROJ);
await fs.writeFile(path.join(sb2, 'a.txt'), 'agent-v2');
await fs.writeFile(path.join(PROJ, 'a.txt'), 'MENSCH-EDIT'); // extern geändert
const res2 = await applySandboxChanges(PROJ, sb2, ['a.txt']);
check('Konflikt erkannt', res2.conflicts.includes('a.txt'));
check('Konflikt nicht angewendet', !res2.applied.includes('a.txt'));
check('Original NICHT überschrieben', (await fs.readFile(path.join(PROJ, 'a.txt'), 'utf8')) === 'MENSCH-EDIT');

// 4) Discard
await discardSandbox(sb2);
check('Sandbox verworfen', !fss.existsSync(sb2));

// 5) Löschen im Sandbox → Delete im Original (nicht konflikt, da unverändert)
const sb3 = await createSandboxCopy(PROJ);
await fs.rm(path.join(sb3, 'neu.txt'));
const res3 = await applySandboxChanges(PROJ, sb3, ['neu.txt']);
check('Löschung übernommen', res3.applied.includes('neu.txt'));
check('Datei im Original gelöscht', !(await fs.stat(path.join(PROJ, 'neu.txt')).then(() => true).catch(() => false)));
await discardSandbox(sb3);

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
