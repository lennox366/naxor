import fs from 'fs';
let s = fs.readFileSync('src/components/TopBar.tsx', 'utf8');
s = s.replace('<div className="t2">Dark Glass</div>', '<div className="t2">The Future of Intelligence</div>');
fs.writeFileSync('src/components/TopBar.tsx', s, 'utf8');
s = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8');
s = s.replace('NAXORA v0.1.0 · Electron + React + TypeScript', 'NAXORA — The Future of Intelligence · v0.1.0 · Electron + React + TypeScript');
fs.writeFileSync('src/pages/SettingsPage.tsx', s, 'utf8');
console.log('claim gesetzt');
