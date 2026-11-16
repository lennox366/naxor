// edge-tts Protokoll-Test: direkter WebSocket-Aufruf (kein npm-Paket)
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F9';
const connId = crypto.randomUUID().replace(/-/g, '');
const ticks = (Date.now() + 11644473600000) * 10000;
const gec = crypto.createHash('sha256').update(String(ticks) + TOKEN).digest('hex').toUpperCase();
const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${connId}`;

const ws = new WebSocket(url, {
  headers: {
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Sec-MS-GEC': gec,
    'Sec-MS-GEC-Version': '1-130.0.2849.68',
  },
});
ws.binaryType = 'nodebuffer';

let audio = [];
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);

ws.onopen = () => {
  const ts = new Date().toISOString();
  ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='de-DE'><voice name='de-DE-KatjaNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>Dies ist ein Test der kostenlosen Sprachfunktion.</prosody></voice></speak>`;
  ws.send(`X-RequestId:${connId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
};
ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') {
    if (ev.data.includes('Path:turn.end')) { ws.close(); }
    return;
  }
  const buf = Buffer.from(ev.data);
  // Binary-Frame: 2-Byte-Header + Payload (edge-tts Format)
  audio.push(buf.length > 2 ? buf.subarray(2) : buf);
};
ws.onclose = () => {
  clearTimeout(timeout);
  const out = Buffer.concat(audio);
  console.log('Audio bytes:', out.length, '| magic:', out.subarray(0, 3).toString('hex'));
  if (out.length > 1000) {
    writeFileSync('test-edge-tts.mp3', out);
    console.log('gespeichert: test-edge-tts.mp3');
  }
  process.exit(out.length > 1000 ? 0 : 1);
};
ws.onerror = (e) => { console.log('WS-Fehler:', e.message || e); };
