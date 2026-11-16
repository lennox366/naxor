// Repariert UTF-8→CP1252-Mojibake: Datei wurde als CP1252 gelesen und als UTF-8 geschrieben.
import fs from 'node:fs';
const file = process.argv[2] || 'src/agent.ts';
const s = fs.readFileSync(file, 'utf8');
// CP1252-Sonderzeichen (0x80-0x9F) → Unicode-Codepoint
const SPECIAL = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};
const bytes = [];
let bad = 0;
for (const ch of s) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) bytes.push(cp);
  else if (cp >= 0xa0 && cp <= 0xff) bytes.push(cp);
  else if (SPECIAL[cp] !== undefined) bytes.push(SPECIAL[cp]);
  else { bad++; bytes.push(0x3f); } // '?' als Marker
}
const fixed = Buffer.from(bytes).toString('utf8');
fs.writeFileSync(file, fixed, 'utf8');
console.log('repariert:', file, '| unzuordbare Zeichen:', bad);
console.log('Probe:', fixed.split('\n').find(l => l.includes('Nachweis'))?.slice(0, 120));
