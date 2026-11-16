import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { writeFileSync } from 'node:fs';

const tts = new MsEdgeTTS();
await tts.setMetadata('de-DE-KatjaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const { audioStream } = tts.toStream('Dies ist ein komplett neuer Testsatz, der nicht in der Originalaufnahme vorkommt.');
const chunks = [];
for await (const chunk of audioStream) chunks.push(chunk);
const buf = Buffer.concat(chunks);
console.log('bytes:', buf.length);
if (buf.length > 500) { writeFileSync('test-edge-tts.mp3', buf); console.log('OK gespeichert'); }
process.exit(buf.length > 500 ? 0 : 1);
