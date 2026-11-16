import initSqlJs from 'sql.js';
import fs from 'node:fs';
const raw = fs.readFileSync(process.env.APPDATA + '/ai-developer-studio/studio.db', 'utf8');
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(Buffer.from(raw.trim(), 'base64')));
const t = db.exec("SELECT status FROM agent_tasks WHERE project_root LIKE '%dev-task%' ORDER BY created_at DESC LIMIT 1")[0];
process.stdout.write(t ? t.values[0][0] : 'unbekannt');
