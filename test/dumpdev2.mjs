import initSqlJs from 'sql.js';
import fs from 'node:fs';
const raw = fs.readFileSync(process.env.APPDATA + '/ai-developer-studio/studio.db', 'utf8');
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(Buffer.from(raw.trim(), 'base64')));
const tid = db.exec("SELECT id FROM agent_tasks WHERE project_root LIKE '%dev-task%' ORDER BY created_at DESC LIMIT 1")[0].values[0][0];
const st = db.exec('SELECT status FROM agent_tasks WHERE id=?', [tid])[0].values[0][0];
console.log('STATUS:', st);
const ev = db.exec('SELECT kind,payload FROM agent_events WHERE task_id=? ORDER BY ts', [tid])[0];
console.log('EVENTS:', ev.values.length);
ev.values.slice(-14).forEach(r => {
  const p = JSON.parse(r[1]);
  console.log(r[0].padEnd(10), (p.name || '').padEnd(16), String(p.result || p.text || '').replace(/\s+/g, ' ').slice(0, 100));
});
