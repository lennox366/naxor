// Setzt projects/activeProject/agentSandbox in studio.db (sql.js, base64).
// Aufruf: node test/db-patch.mjs [--sandbox on|off]
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

const DB = path.join(process.env.APPDATA, 'ai-developer-studio', 'studio.db');
const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
const PROJ = 'C:\\Users\\User\\Desktop\\tasten\\Code KI alles\\test-projekt';

const SQL = await initSqlJs({ locateFile: () => WASM });
const b64 = fs.readFileSync(DB, 'utf8').trim();
const db = new SQL.Database(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));

const get = (k) => {
  const r = db.exec(`SELECT value FROM settings WHERE key='${k}'`);
  return r.length && r[0].values.length ? JSON.parse(r[0].values[0][0]) : undefined;
};
const set = (k, v) => db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES ('${k}', ?)`, [JSON.stringify(v)]);

const projects = get('projects') || [];
if (!projects.find(p => p.path === PROJ)) projects.push({ name: 'test-projekt', path: PROJ });
set('projects', projects);
set('activeProject', PROJ);
if (process.argv.includes('--sandbox')) {
  const on = process.argv[process.argv.indexOf('--sandbox') + 1] !== 'off';
  set('agentSandbox', on);
}
console.log('projects:', JSON.stringify(get('projects')));
console.log('activeProject:', get('activeProject'));
console.log('agentSandbox:', get('agentSandbox'));
console.log('provider:', get('provider'));

fs.writeFileSync(DB, Buffer.from(db.export()).toString('base64'));
console.log('DB gespeichert');
