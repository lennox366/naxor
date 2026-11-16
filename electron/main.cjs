const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');

// Allow fetch() of bundled assets (sql.js wasm) when running from file://
app.commandLine.appendSwitch('allow-file-access-from-files');
const path = require('path');
const fs = require('fs');

// ADS_DEV=1 → dev server; otherwise packaged-style file:// load of dist/
const isDev = process.env.ADS_DEV === '1';
const userData = () => app.getPath('userData');
const dbPath = () => path.join(userData(), 'studio.db');
const filesDir = () => path.join(userData(), 'files');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#07080a',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Permission handling: allow mic + clipboard etc.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const ok = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(permission);
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return ['media', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission);
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ---------- IPC: window controls ----------
ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('win:close', () => win?.close());
ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false);

// ---------- IPC: file system ----------
ipcMain.handle('fs:readDir', async (_e, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(en => !en.name.startsWith('.'))
      .map(en => ({
        name: en.name,
        isDir: en.isDirectory(),
        path: path.join(dirPath, en.name),
      }));
  } catch (err) {
    throw new Error(`Lesefehler: ${err.message}`);
  }
});

ipcMain.handle('fs:readFile', async (_e, filePath, maxBytes = 2_000_000) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > maxBytes) throw new Error('Datei zu groß zum Lesen (>2MB)');
    const buf = await fs.promises.readFile(filePath);
    return buf.toString('utf8');
  } catch (err) {
    throw new Error(`Lesefehler: ${err.message}`);
  }
});

ipcMain.handle('fs:readFileBase64', async (_e, filePath) => {
  try {
    const buf = await fs.promises.readFile(filePath);
    return { base64: buf.toString('base64'), size: buf.length };
  } catch (err) {
    throw new Error(`Lesefehler: ${err.message}`);
  }
});

ipcMain.handle('fs:writeFile', async (_e, filePath, content) => {
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
    return true;
  } catch (err) {
    throw new Error(`Schreibfehler: ${err.message}`);
  }
});

ipcMain.handle('fs:pickFiles', async (_e, opts = {}) => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: opts.filters,
  });
  if (res.canceled) return [];
  return res.filePaths;
});

ipcMain.handle('fs:pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('fs:saveFile', async (_e, defaultName, content) => {
  const res = await dialog.showSaveDialog(win, { defaultPath: defaultName });
  if (res.canceled) return null;
  await fs.promises.writeFile(res.filePath, content, 'utf8');
  return res.filePath;
});

// window.confirm/alert/prompt werden in Electron nicht unterstützt —
// Bestätigungsdialoge laufen über diesen nativen Dialog.
ipcMain.handle('dialog:confirm', async (_e, opts = {}) => {
  const res = await dialog.showMessageBox(win, {
    type: opts.danger ? 'warning' : 'question',
    buttons: ['Abbrechen', 'OK'],
    defaultId: 1,
    cancelId: 0,
    title: opts.title || 'Bestätigung',
    message: String(opts.message || ''),
    detail: opts.detail ? String(opts.detail) : undefined,
  });
  return res.response === 1;
});

ipcMain.handle('dialog:alert', async (_e, opts = {}) => {
  await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['OK'],
    title: opts.title || 'Hinweis',
    message: String(opts.message || ''),
    detail: opts.detail ? String(opts.detail) : undefined,
  });
});

ipcMain.handle('app:paths', () => ({
  userData: userData(),
  filesDir: filesDir(),
  dbPath: dbPath(),
  isDev,
}));

ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));

ipcMain.handle('app:revealPath', (_e, p) => shell.showItemInFolder(p));

// ---------- IPC: extended file ops (workspace-scoped) ----------
function safeJoin(root, rel) {
  const p = path.resolve(root, rel || '.');
  const rootResolved = path.resolve(root);
  if (p !== rootResolved && !p.startsWith(rootResolved + path.sep)) {
    throw new Error('Zugriff außerhalb des Projektordners verweigert');
  }
  return p;
}

ipcMain.handle('fs:listTree', async (_e, root, opts = {}) => {
  const maxDepth = opts.maxDepth ?? 4;
  const skip = new Set(['node_modules', '.git', 'dist', '.next', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'target', 'release', '.idea', '.vs']);
  const out = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || out.length > 3000) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const en of entries) {
      if (en.name.startsWith('.') && depth > 0) continue;
      if (skip.has(en.name)) continue;
      const p = path.join(dir, en.name);
      const isDir = en.isDirectory();
      out.push({ name: en.name, path: p, isDir, depth });
      if (isDir) await walk(p, depth + 1);
    }
  }
  await walk(path.resolve(root), 0);
  return out;
});

ipcMain.handle('fs:deletePath', async (_e, root, rel) => {
  const p = safeJoin(root, rel);
  await fs.promises.rm(p, { recursive: true, force: false });
  return true;
});

ipcMain.handle('fs:renamePath', async (_e, root, fromRel, toRel) => {
  const from = safeJoin(root, fromRel);
  const to = safeJoin(root, toRel);
  await fs.promises.rename(from, to);
  return true;
});

ipcMain.handle('fs:mkdir', async (_e, root, rel) => {
  const p = safeJoin(root, rel);
  await fs.promises.mkdir(p, { recursive: true });
  return true;
});

ipcMain.handle('fs:exists', async (_e, root, rel) => {
  try { await fs.promises.access(safeJoin(root, rel)); return true; } catch { return false; }
});

ipcMain.handle('fs:stat', async (_e, root, rel) => {
  const st = await fs.promises.stat(safeJoin(root, rel));
  return { size: st.size, isDir: st.isDirectory(), mtime: st.mtimeMs };
});

// ---------- IPC: terminal ----------
const { spawn } = require('child_process');
const os = require('os');
const procs = new Map(); // pid -> child
const termRuns = new Map(); // runId -> { proc, killed }

function killProcessTree(proc) {
  if (!proc || proc.killedFlag) return;
  proc.killedFlag = true;
  if (process.platform === 'win32' && proc.pid) {
    // taskkill /T beendet auch alle Kindprozesse (z. B. python.exe unter powershell)
    try { spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    setTimeout(() => { try { proc.kill(); } catch {} }, 800);
  } else {
    try { proc.kill('SIGKILL'); } catch {}
  }
}

ipcMain.handle('proc:spawn', async (_e, opts) => {
  const { command, args = [], cwd, env = {} } = opts;
  const child = spawn(command, args, {
    cwd: cwd || undefined,
    env: { ...process.env, ...env },
    detached: false,
    windowsHide: true,
  });
  child.unref();
  child.stdout?.resume();
  child.stderr?.resume();
  procs.set(child.pid, child);
  child.on('exit', () => procs.delete(child.pid));
  return { pid: child.pid };
});

ipcMain.handle('proc:kill', async (_e, pid) => {
  const c = procs.get(pid);
  if (c) { try { c.kill(); } catch {} procs.delete(pid); return true; }
  try { process.kill(pid); return true; } catch { return false; }
});

ipcMain.handle('proc:running', async (_e, pid) => {
  const c = procs.get(pid);
  if (c) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
});

ipcMain.handle('app:env', () => ({ home: os.homedir(), platform: process.platform }));

ipcMain.handle('term:run', async (e, opts) => {
  const { cwd, command, timeoutMs = 120000, runId } = opts;
  return await new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const proc = spawn(isWin ? 'powershell.exe' : 'bash', isWin ? ['-NoProfile', '-Command', command] : ['-lc', command], {
      cwd: cwd || undefined,
      env: { ...process.env, TERM: 'dumb' },
    });
    const entry = { proc, killed: false };
    if (runId) termRuns.set(runId, entry);
    let out = '', err = '', done = false;
    const finish = (code) => {
      if (done) return; done = true;
      clearTimeout(timer);
      if (runId) termRuns.delete(runId);
      resolve({ code: code ?? -1, killed: !!entry.killed, timedOut: !!entry.timedOut, stdout: out.slice(-200000), stderr: err.slice(-100000) });
    };
    const timer = setTimeout(() => { entry.timedOut = true; killProcessTree(entry.proc); finish(null); }, timeoutMs);
    proc.stdout.on('data', d => { out += d.toString(); e.sender.send('term:chunk', d.toString()); });
    proc.stderr.on('data', d => { err += d.toString(); e.sender.send('term:chunk', d.toString()); });
    proc.on('error', er => { err += String(er); finish(-1); });
    proc.on('close', code => finish(entry.killed ? -1 : code));
  });
});

ipcMain.handle('term:kill', async (_e, runId) => {
  const entry = termRuns.get(runId);
  if (!entry) return false;
  entry.killed = true;
  killProcessTree(entry.proc);
  return true;
});

// ---------- IPC: llama-server manager (CPU-only universal endpoint) ----------
let llmProc = null;
let llmModelPath = null;
let llmMmproj = null;
let llmLastError = null;
let llmLogTail = '';

ipcMain.handle('llm:start', async (_e, opts) => {
  const { modelPath, port = 8080, ctx = 8192, mmproj } = opts || {};
  if (!modelPath) throw new Error('Kein Modellpfad');
  if (llmProc && llmModelPath === modelPath && llmMmproj === (mmproj || null)) return { ok: true, already: true };
  try { llmProc?.kill(); } catch {}
  await new Promise(r => setTimeout(r, 400));
  const bin = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'lib', 'ollama', 'llama-server.exe');
  const exe = fs.existsSync(bin) ? bin : 'llama-server';
  const args = ['-m', modelPath, '--port', String(port), '-ngl', '0', '-c', String(ctx)];
  if (mmproj) args.push('--mmproj', mmproj);
  llmProc = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  llmModelPath = modelPath;
  llmMmproj = mmproj || null;
  llmLastError = null;
  llmLogTail = '';
  llmProc.stderr.on('data', (d) => {
    const s = d.toString();
    llmLogTail = (llmLogTail + s).slice(-8000);
    const lower = s.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('out of memory') || lower.includes('abort')) {
      llmLastError = s.trim().slice(0, 500);
    }
  });
  llmProc.on('exit', (code) => {
    if (code !== 0 && code !== null) llmLastError = llmLastError || `llama-server beendet sich mit Code ${code}`;
    llmProc = null; llmModelPath = null; llmMmproj = null;
  });
  return { ok: true };
});

ipcMain.handle('llm:stop', async () => {
  try { llmProc?.kill(); } catch {}
  llmProc = null; llmModelPath = null; llmMmproj = null;
  return true;
});

ipcMain.handle('llm:status', async () => ({
  running: !!llmProc,
  modelPath: llmModelPath,
  mmproj: llmMmproj,
  lastError: llmLastError,
  logTail: llmLogTail.slice(-2000),
}));

// ---------- IPC: ElevenLabs TTS ----------
// Der API-Key wird vom Renderer übergeben (in den lokalen Einstellungen
// gespeichert) und nur hier im Hauptprozess für den API-Aufruf verwendet.
ipcMain.handle('tts:elevenlabs', async (_e, opts = {}) => {
  const { text, apiKey, voiceId } = opts || {};
  if (!text || typeof text !== 'string') return { ok: false, error: 'Kein Text zum Vorlesen übergeben.' };
  if (!apiKey) return { ok: false, error: 'Kein ElevenLabs API-Key konfiguriert — Einstellungen → Sprache → API-Key eintragen.' };
  if (!voiceId) return { ok: false, error: 'Keine ElevenLabs Voice-ID konfiguriert.' };
  const clean = text.replace(/```[\s\S]*?```/g, ' Codeblock. ').replace(/[#*`\[\]()>_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500);
  if (!clean) return { ok: false, error: 'Nach dem Bereinigen blieb kein Text übrig.' };
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j?.detail?.message || j?.detail || ''; } catch {}
      if (res.status === 401) return { ok: false, error: 'ElevenLabs-API-Schlüssel ungültig oder abgelaufen (401).' };
      if (res.status === 429) return { ok: false, error: 'ElevenLabs-Anfragelimit erreicht (429) — bitte später erneut versuchen oder Tarif prüfen.' };
      return { ok: false, error: `ElevenLabs-Fehler ${res.status}${detail ? ': ' + String(detail).slice(0, 200) : ''}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: 'ElevenLabs lieferte eine leere Audiodatei.' };
    return { ok: true, audioBase64: buf.toString('base64'), contentType: res.headers.get('content-type') || 'audio/mpeg' };
  } catch (e) {
    return { ok: false, error: `Verbindung zu ElevenLabs fehlgeschlagen: ${e?.message || e}` };
  }
});

// ---------- IPC: Edge-TTS (Microsoft Online, kostenlos, kein Key) ----------
// Klare Kennzeichnung: ONLINE-Sprachausgabe, keine Stimmklon-Stimme.
let edgeTtsModule = null;
async function getEdgeTts() {
  if (!edgeTtsModule) edgeTtsModule = await import('msedge-tts');
  return edgeTtsModule;
}

ipcMain.handle('tts:edge', async (_e, opts = {}) => {
  const { text, voice } = opts || {};
  if (!text || typeof text !== 'string') return { ok: false, error: 'Kein Text zum Vorlesen übergeben.' };
  const clean = text.replace(/```[\s\S]*?```/g, ' Codeblock. ').replace(/[#*`\[\]()>_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500);
  if (!clean) return { ok: false, error: 'Nach dem Bereinigen blieb kein Text übrig.' };
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await getEdgeTts();
    const tts = new MsEdgeTTS();
    const voiceName = voice || 'de-DE-KatjaNeural';
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(clean);
    const chunks = [];
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    if (!buf.length) return { ok: false, error: 'Edge-TTS lieferte keine Audiodaten (Online-Dienst nicht erreichbar?).' };
    return { ok: true, audioBase64: buf.toString('base64'), contentType: 'audio/mpeg', online: true };
  } catch (e) {
    return { ok: false, error: `Edge-TTS fehlgeschlagen (Online-Dienst): ${e?.message || e}` };
  }
});

// ---------- IPC: Systeminfo ----------
ipcMain.handle('sys:info', async () => {
  const os = require('os');
  const cpus = os.cpus();
  let load = 0;
  try {
    const loadavg = os.loadavg();
    load = Math.min(100, Math.round((loadavg[0] / cpus.length) * 100));
  } catch {}
  return {
    cpus: cpus.length,
    cpuModel: cpus[0]?.model || 'unbekannt',
    cpuLoad: load,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptime: os.uptime(),
  };
});

app.whenReady().then(() => {
  fs.mkdirSync(filesDir(), { recursive: true });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
