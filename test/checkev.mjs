import initSqlJs from 'sql.js';
import fs from 'node:fs';
const raw = fs.readFileSync(process.env.APPDATA + '/ai-developer-studio/studio.db', 'utf8');
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(Buffer.from(raw.trim(), 'base64')));
const tid = db.exec("SELECT id FROM agent_tasks WHERE prompt LIKE 'Analysiere%' ORDER BY created_at DESC LIMIT 1")[0].values[0][0];
const ev = db.exec('SELECT kind,payload FROM agent_events WHERE task_id=? ORDER BY ts', [tid])[0];
ev.values.forEach(r => { const p = JSON.parse(r[1]); console.log(r[0], '|', p.name || '', JSON.stringify(p.args || {}).slice(0, 70), '|', String(p.result || p.text || '').slice(0, 200).replace(/\n/g, ' ')); });
