import fs from 'fs';
const f = process.argv[2];
const buf = fs.readFileSync(f);
console.log('size:', buf.length, 'bytes');
// ID3-Tag überspringen
let off = 0;
if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'ID3') {
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  off = 10 + size;
  console.log('ID3v2 Tag, Audio ab Byte', off);
}
const brTab = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]; // MPEG1 Layer3 kbps
const srTab = [44100,48000,32000];
let frames = 0, firstH = null, lastOff = 0;
for (let i = off; i < buf.length - 4; i++) {
  if (buf[i] === 0xff && (buf[i+1] & 0xe0) === 0xe0) {
    const ver = (buf[i+1] >> 3) & 3; // 3=MPEG1
    const layer = (buf[i+1] >> 1) & 3;
    const bri = (buf[i+2] >> 4) & 15;
    const sri = (buf[i+2] >> 2) & 3;
    if (ver === 3 && layer === 1 && bri > 0 && bri < 15 && sri < 3) {
      if (!firstH) firstH = { bri, sri };
      const br = brTab[bri] * 1000;
      const sr = srTab[sri];
      const flen = Math.floor(144 * br / sr) + ((buf[i+2] >> 1) & 1 ? 1 : 0);
      frames++; lastOff = i + flen; i += flen - 1;
    }
  }
}
if (firstH) {
  const br = brTab[firstH.bri] * 1000, sr = srTab[firstH.sri];
  const dur = frames * 1152 / sr;
  console.log(`Frames: ${frames}, Bitrate: ${br/1000} kbps, SampleRate: ${sr} Hz`);
  console.log(`Dauer: ca. ${dur.toFixed(1)} Sekunden`);
} else console.log('Keine MP3-Frames gefunden (evtl. VBR/Xing oder anderes Format)');
