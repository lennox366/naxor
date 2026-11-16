import fs from 'fs';
import init from 'sql.js';
const b64 = fs.readFileSync(process.env.APPDATA + '/ai-developer-studio/studio.db', 'utf8').trim();
const SQL = await init();
const db = new SQL.Database(Buffer.from(b64, 'base64'));
const r = db.exec("SELECT key, value FROM settings WHERE key IN ('ttsEngine','elevenKey','elevenVoiceId','ttsVolume','voiceURI')");
for (const [k, v] of (r[0]?.values || [])) {
  if (k === 'elevenKey') {
    try { const j = JSON.parse(v); console.log(k, '=', j ? `"${'*'.repeat(Math.min(8, String(j).length))}…(len ${String(j).length})"` : '(leer)'); }
    catch { console.log(k, '= (roh, len', String(v).length, ')'); }
  } else console.log(k, '=', v);
}
