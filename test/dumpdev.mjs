import initSqlJs from 'sql.js';
import fs from 'node:fs';
const raw = fs.readFileSync(process.env.APPDATA + '/ai-developer-studio/studio.db', 'utf8');
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(Buffer.from(raw.trim(), 'base64')));
const t = db.exec("SELECT id,status,result FROM agent_tasks WHERE project_root LIKE '%dev-task%' ORDER BY created_at DESC LIMIT 1")[0].values[0];
console.log('=== TASK', t[0], '| STATUS:', t[1], '===');
const ev = db.exec('SELECT kind,payload FROM agent_events WHERE task_id=? ORDER BY ts', [t[0]])[0];
console.log('--- EVENTS (' + ev.values.length + ') ---');
ev.values.forEach(r => {
  const p = JSON.parse(r[1]);
  const arg = JSON.stringify(p.args || {}).slice(0, 100);
  const res = String(p.result || p.text || '').replace(/\s+/g, ' ').slice(0, 110);
  console.log(`${r[0].padEnd(10)} ${p.name || ''} ${arg} → ${res}`);
});
console.log('--- RESULT (first 800) ---');
console.log(String(t[2]).slice(0, 800));
