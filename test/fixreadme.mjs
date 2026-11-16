import fs from 'fs';
const p = 'README.md';
let s = fs.readFileSync(p, 'utf8');
if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
const special = { '€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,'Š':0x8A,'‹':0x8B,'Œ':0x8C,'Ž':0x8E,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,'˜':0x98,'™':0x99,'š':0x9A,'›':0x9B,'œ':0x9C,'ž':0x9E,'Ÿ':0x9F };
const bytes = [];
for (const ch of s) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) bytes.push(cp);
  else if (cp >= 0xa0 && cp <= 0xff) bytes.push(cp);
  else if (special[ch] != null) bytes.push(special[ch]);
  else bytes.push(cp & 0xff);
}
const fixed = Buffer.from(bytes).toString('utf8');
fs.writeFileSync(p, fixed, 'utf8');
const bad = fixed.match(/Ã.|â€|�/g);
console.log('mojibake nach Fix:', bad ? bad.slice(0,5) : 'keiner');
console.log(fixed.slice(0, 200));
