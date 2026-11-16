import { AISettings } from './types';
import { AgentMessage, ToolDef, ollamaAgentStep, openAIToolStep } from './services/ai';
import { query, run } from './db';

export interface AgentEvent {
  type: 'token' | 'tool' | 'filechange' | 'filediff' | 'confirm' | 'done' | 'error' | 'verify' | 'sandbox';
  text?: string;
  name?: string;
  args?: any;
  result?: string;
  ok?: boolean;
  path?: string;
  oldText?: string;
  newText?: string;
  ts?: number;
}

/** Befehlsmuster, die als echter Funktionstest gelten (Syntax-Checks zählen nicht). */
const TEST_CMD_RE = /(pytest|unittest|npm\s+(run\s+)?test|node\s+-e\b|node\s+[\w./\\-]+\.(js|mjs|cjs)|python3?\s+-c\b|python\s+[\w./\\-]+\.py|python3?\s+-m\s+(?!py_compile\b)|jest|vitest|go\s+test|cargo\s+test|mvn\s+test|dotnet\s+test|phpunit|rspec|ctest|make\s+test)/i;

/** Protokoll eines tatsächlich ausgeführten Terminalbefehls — nur diese Daten gelten als Testnachweis. */
export interface CmdRecord {
  id: string;          // eindeutige Befehls-ID im Auftrag
  auftragId: string;   // eindeutige ID des Agent-Auftrags
  command: string;     // vollständiger ausgeführter Befehl
  code: number;        // Exit-Code
  killed?: boolean;    // abgebrochen
  timedOut?: boolean;  // Timeout
  auto?: boolean;      // automatisch erzeugter Syntax-Check
  expect?: string;     // erwarteter Text in stdout (run_test)
  expectMet?: boolean; // wurde die Erwartung tatsächlich erfüllt?
  stdout?: string;     // tatsächliche Standardausgabe (gekürzt)
  stderr?: string;     // tatsächliche Fehlerausgabe (gekürzt)
  ts: number;          // Zeitstempel
}

interface AgentOpts {
  settings: AISettings;
  projectRoot: string;
  projectName?: string;
  history: { role: string; content: string }[];
  userMessage: string;
  onEvent: (e: AgentEvent) => void;
  onConfirmCommand?: (cmd: string) => Promise<boolean>;
  signal?: AbortSignal;
  /** Sandbox-Modus: Agent arbeitet in einer Kopie; Original bleibt unverändert. */
  sandbox?: boolean;
}

export interface AgentResult {
  /** Pfad der Sandbox-Kopie (nur wenn sandbox=true und erfolgreich). */
  sandboxRoot?: string;
  /** Relative Pfade der geänderten Dateien (gegenüber workRoot). */
  changedFiles: string[];
  /** Auftrag verlangte eine Änderung, aber kein Schreibzugriff wurde verifiziert. */
  unverifiedClaim?: boolean;
}

// Laufende Agent-Befehle — werden bei Abbruch gekillt
const agentRuns = new Set<string>();
const DANGEROUS = /(\brm\s|\bdel\b|\brmdir\b|\bformat\b|\bshutdown\b|\brestart(-computer)?\b|mkfs|\bdd\s+if=|>\s*\/dev|remove-item|clear-disk|reg\s+(delete|add)|net\s+(user|localgroup)|set-executionpolicy|iex\b|invoke-expression|curl[^|]*\|\s*(iex|sh|bash)|wget[^|]*\|\s*(iex|sh|bash)|git\s+(commit|push|reset|rebase|merge|clean|checkout)\b)/i;

const studio = () => (window as any).studio;

function toRel(root: string, p: string): string {
  const norm = p.replace(/\\/g, '/');
  const rootN = root.replace(/\\/g, '/').replace(/\/$/, '');
  return norm.startsWith(rootN + '/') ? norm.slice(rootN.length + 1) : norm;
}

function abs(root: string, rel: string): string {
  const raw = String(rel || '').trim();
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/')) {
    // absolute path inside project only
    const r = raw.replace(/\\/g, '/');
    const rootN = root.replace(/\\/g, '/').replace(/\/$/, '');
    if (!r.startsWith(rootN + '/')) throw new Error('Pfad liegt außerhalb des Projekts');
    rel = r.slice(rootN.length + 1); // zu relativ normalisieren
  }
  // Ungültige Zeichen in Pfadsegmenten (Windows) und Traversal abfangen
  const segments = rel.replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
  if (segments.some(s => /[<>:"|?*]/.test(s) || s === '..')) {
    throw new Error(`Ungültiger Pfad: ${rel} — verwende nur einfache relative Pfade innerhalb des Projekts`);
  }
  return root.replace(/[\\/]+$/, '') + '/' + segments.join('/');
}

async function backupFile(root: string, rel: string): Promise<string | null> {
  try {
    const content = await studio().fs.readFile(abs(root, rel));
    const paths = await studio().app.paths();
    const hash = root.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
    const bakRel = `backups/${hash}/${rel.replace(/[\\/]/g, '__')}`;
    const bakAbs = paths.filesDir + '/' + bakRel;
    await studio().fs.writeFile(bakAbs, content);
    return bakAbs;
  } catch { return null; }
}

export function getBackupPath(root: string, rel: string): string {
  const hash = root.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
  return `backups/${hash}/${rel.replace(/[\\/]/g, '__')}`;
}

export async function readBackup(root: string, rel: string): Promise<string | null> {
  try {
    const paths = await studio().app.paths();
    return await studio().fs.readFile(paths.filesDir + '/' + getBackupPath(root, rel));
  } catch { return null; }
}

// ---------- Sandbox-Modus: Agent arbeitet in einer Kopie ----------

/** Schneller Hash für Konflikterkennung (kein Krypto nötig — nur Änderungsdetektion). */
function quickHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

const SANDBOX_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'target', 'release', '.idea', '.vs', '.aistudio']);
const SANDBOX_MAX_FILE = 2_000_000;

/** Erstellt eine vollständige Arbeitskopie des Projekts im filesDir.
 *  Schreibt zusätzlich ein Manifest (rel → Hash des Originalinhalts) als
 *  `<sandbox>.manifest.json` — Grundlage für die Konflikterkennung beim Übernehmen. */
export async function createSandboxCopy(root: string): Promise<string | null> {
  const s = studio();
  const paths = await s.app.paths();
  const hash = root.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
  const sandbox = `${paths.filesDir}/sandbox/${hash}-${Date.now().toString(36)}`;
  const tree = await s.fs.listTree(root, { maxDepth: 10 });
  const manifest: Record<string, string> = {};
  let copied = 0;
  for (const n of tree) {
    if (n.isDir) continue;
    if (n.name.startsWith('.')) continue; // keine Dotfiles/.env in die Kopie
    const rel = toRel(root, n.path).replace(/\\/g, '/');
    const top = rel.split('/')[0];
    if (SANDBOX_SKIP_DIRS.has(top) || SANDBOX_SKIP_DIRS.has(n.name)) continue;
    try {
      const st = await s.fs.stat(root, rel);
      if (st.size > SANDBOX_MAX_FILE) continue;
      const content = await s.fs.readFile(n.path, SANDBOX_MAX_FILE);
      await s.fs.writeFile(`${sandbox}/${rel}`, content);
      manifest[rel] = quickHash(content);
      copied++;
    } catch { /* einzelne Dateien überspringen */ }
  }
  if (copied === 0) return null;
  try { await s.fs.writeFile(`${sandbox}.manifest.json`, JSON.stringify(manifest)); } catch { /* Manifest optional */ }
  return sandbox;
}

/** Übernimmt Sandbox-Änderungen ins Originalprojekt (mit Backup).
 *  Konflikterkennung: Wurde eine Originaldatei NACH der Kopie externally
 *  geändert (Hash ≠ Manifest) oder existiert eine neue Sandbox-Datei bereits
 *  im Original, wird die Datei NICHT überschrieben — sie landet in `conflicts`. */
export async function applySandboxChanges(
  projectRoot: string,
  sandboxRoot: string,
  changedFiles: string[],
): Promise<{ applied: string[]; failed: string[]; skipped: string[]; conflicts: string[] }> {
  const s = studio();
  const applied: string[] = [], failed: string[] = [], skipped: string[] = [], conflicts: string[] = [];
  // Manifest mit Original-Hashes laden (erstellt bei createSandboxCopy)
  let manifest: Record<string, string> = {};
  try {
    manifest = JSON.parse(await s.fs.readFile(`${sandboxRoot}.manifest.json`, 5_000_000));
  } catch { /* kein Manifest → ohne Konfliktschutz */ }
  for (const rel of changedFiles) {
    try {
      const inSand = await s.fs.exists(sandboxRoot, rel);
      const inOrig = await s.fs.exists(projectRoot, rel);
      // Konflikt prüfen, BEVOR irgendetwas geschrieben wird
      const hadInOrig = rel in manifest;
      if (inOrig) {
        const origContent = await s.fs.readFile(abs(projectRoot, rel), SANDBOX_MAX_FILE);
        const origHash = quickHash(origContent);
        if (hadInOrig) {
          if (origHash !== manifest[rel]) { conflicts.push(rel); continue; } // Original extern geändert
        } else if (inSand) {
          conflicts.push(rel); continue; // Sandbox-Neu.datei existiert inzwischen auch im Original
        }
      } else if (hadInOrig) {
        // Datei war im Original, wurde inzwischen gelöscht → ebenfalls Konflikt
        conflicts.push(rel); continue;
      }
      if (inSand === inOrig) {
        if (inSand) {
          const a = await s.fs.readFile(`${sandboxRoot}/${rel}`, SANDBOX_MAX_FILE);
          const b = await s.fs.readFile(abs(projectRoot, rel), SANDBOX_MAX_FILE);
          if (a === b) { skipped.push(rel); continue; }
        } else { skipped.push(rel); continue; }
      }
      if (inOrig) await backupFile(projectRoot, rel);
      if (inSand) {
        const content = await s.fs.readFile(`${sandboxRoot}/${rel}`, SANDBOX_MAX_FILE);
        await s.fs.writeFile(abs(projectRoot, rel), content);
      } else {
        await s.fs.deletePath(projectRoot, rel);
      }
      applied.push(rel);
    } catch { failed.push(rel); }
  }
  return { applied, failed, skipped, conflicts };
}

/** Verwirft eine Sandbox-Kopie. */
export async function discardSandbox(sandboxRoot: string): Promise<void> {
  try { await studio().fs.deletePath(sandboxRoot, '.'); } catch { /* ignore */ }
}

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Listet Dateien und Unterordner eines Verzeichnisses im Projekt.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relativer Pfad, Standard: Projektwurzel' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Liest den Inhalt einer Textdatei. Große Dateien werden gekürzt.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Erstellt oder überschreibt eine Datei mit neuem Inhalt. Erstellt fehlende Ordner. Vor dem Überschreiben wird automatisch ein Backup angelegt.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Löscht eine Datei oder einen Ordner (rekursiv).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mkdir',
      description: 'Erstellt ein Verzeichnis (inkl. fehlender Elternordner).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_path',
      description: 'Benennt eine Datei/einen Ordner um oder verschiebt sie.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Führt einen Terminalbefehl im Projektordner aus (PowerShell unter Windows). Kritische Befehle erfordern Nutzerbestätigung.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_test',
      description: 'Führt einen Testbefehl aus und prüft die TATSÄCHLICHE Ausgabe gegen eine Erwartung. IMMERVorrang vor run_command für Funktionstests: exit 0 allein beweist nichts — die Ausgabe muss den erwarteten Wert enthalten. expect muss die exakte erwartete Ausgabe sein (z. B. „subtrahiere(5,3)= 2"), niemals nur eine beliebige Zahl.',
      parameters: { type: 'object', properties: {
        command: { type: 'string', description: 'Auszuführender Befehl' },
        expect: { type: 'string', description: 'Text, der in der Standardausgabe enthalten sein muss (z. B. "42")' },
        expect_exit: { type: 'number', description: 'Erwarteter Exit-Code, Standard 0' },
      }, required: ['command', 'expect'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Durchsucht Dateiinhalte nach einem Text (grep-ähnlich).',
      parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string', description: 'Optional: Unterordner' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Ersetzt eine Textpassage in einer Datei (alte Passage → neue Passage). Sicherer als write_file für kleine Änderungen. Whitespace-Unterschiede (Einrückung) werden automatisch toleriert.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_lines',
      description: 'Ersetzt einen exakten Zeilenbereich (start_line bis end_line, 1-basiert, inklusiv) durch new_text — KEIN altes Text-Snippet nötig. Nach read_file (Zeilennummern sichtbar) die betroffenen Zeilennummern angeben. Backup + Rücklesen + JSON-Check inklusive. Bevorzugt für den 3B-Modell-Fall, wo exakt kopierter old_text scheitert.',
      parameters: { type: 'object', properties: {
        path: { type: 'string' },
        start_line: { type: 'number', description: 'Erste zu ersetzende Zeile (1-basiert)' },
        end_line: { type: 'number', description: 'Letzte zu ersetzende Zeile (standard = start_line)' },
        new_text: { type: 'string', description: 'Ersatztext für diesen Bereich' },
      }, required: ['path', 'start_line', 'new_text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_json_value',
      description: 'Setzt einen Wert in einer JSON-Datei anhand des Schlüsselnamens (z. B. „feedbackChannelId“ oder verschachtelt „config.channelId“). KEIN altes Text-Snippet nötig — ideal für Konfigurationen. Wert bleibt String, sofern er nicht eindeutig number/boolean ist. Vor dem Schreiben wird ein Backup angelegt und danach zurückgelesen + validiert.',
      parameters: { type: 'object', properties: {
        path: { type: 'string' },
        key: { type: 'string', description: 'Schlüsselname oder Punkt-Pfad, z. B. "feedbackChannelId"' },
        value: { type: 'string', description: 'Neuer Wert als Text (Zahlen >15 Stellen und IDs bleiben Strings)' },
        create_missing: { type: 'boolean', description: 'true = fehlende Schlüssel anlegen (Standard), false = nur vorhandene ändern' },
      }, required: ['path', 'key', 'value'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Speichert Wissen dauerhaft in der gemeinsamen Wissensdatenbank — für ALLE KI-Bereiche nutzbar. scope=„global“ für projektübergreifendes Wissen (Sprachen, Frameworks, allgemeine Fehler), scope=„projekt“ (Standard) für projektspezifische Fakten. verified=1 NUR wenn die Information auf echten, im Protokoll nachvollziehbaren Werkzeug-Ergebnissen beruht (z. B. bestandener run_test, bestätigter Bugfix) — niemals für bloße Vermutungen oder Modellbehauptungen.',
      parameters: { type: 'object', properties: {
        title: { type: 'string' }, content: { type: 'string' },
        kind: { type: 'string', description: 'z. B. projekt, fehler, entscheidung, bibliothek, testergebnis, architektur, regel' },
        scope: { type: 'string', description: '„global“ oder „projekt“ (Standard)' },
        verified: { type: 'boolean', description: 'true nur bei durch echte Tool-Ergebnisse bestätigtem Wissen' },
      }, required: ['title', 'content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: 'Durchsucht die gemeinsame Wissensdatenbank nach Stichworten — nutzt sowohl projektspezifisches als auch globales, von anderen KI-Bereichen geteiltes Wissen (für Projektkontext aus früheren Sitzungen).',
      parameters: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Sucht kostenlos im Internet (DuckDuckGo) nach Dokumentation, Fehlerlösungen oder Bibliotheken. Optional.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Lädt eine Webseiten-URL und gibt den Textinhalt zurück (für Dokumentation/Recherche).',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'project_overview',
      description: 'Analysiert das gesamte Projekt in EINEM Aufruf: Verzeichnisstruktur, erkannte Programmiersprachen (Datei-Anzahlen), Build-/Dependency-Dateien (package.json, requirements.txt, pom.xml, Cargo.toml, go.mod, composer.json, pubspec.yaml, *.csproj, CMakeLists.txt, Dockerfile u. a.) und Git-Vorhandensein. IMMER zuerst bei Projektstart oder größerem Auftrag nutzen — spart viele list_dir-Aufrufe.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Liest den Git-Zustand des Projekts (NUR LESEN, verändert nichts): Branch, geänderte/unversionierte Dateien (git status), Diff-Statistik und die letzten 5 Commits. Für Projektanalyse und Änderungsverfolgung. Mutierende Git-Befehle (commit, push, checkout, reset …) laufen weiterhin über run_command mit Nutzer-Bestätigung.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Sensible Dateien, die der Agent niemals lesen oder verändern darf. */
function isProtectedPath(rel: string): boolean {
  const base = String(rel || '').split(/[\\/]/).pop() || '';
  if (/^\.env(\..+)?$/i.test(base)) {
    // .env.example / .env.sample / .env.template sind erlaubt
    return !/\.(example|sample|template|dist)$/i.test(base);
  }
  return /\.(pem|key|p12|pfx)$/i.test(base) || /id_rsa|credentials/i.test(base);
}

async function execTool(name: string, args: any, root: string, onConfirm?: (c: string) => Promise<boolean>, cmdLog?: CmdRecord[], auftragId?: string, onDiff?: (d: { path: string; oldText: string; newText: string }) => void): Promise<string> {
  const s = studio();
  // .env & Zugangsdaten sind für den Agenten tabu (Lesen UND Schreiben)
  const fileArg = args.path || args.from || args.to;
  if (['read_file', 'write_file', 'edit_file', 'delete_path', 'rename_path', 'search_files'].includes(name) && fileArg && isProtectedPath(String(fileArg))) {
    return 'FEHLER: Diese Datei enthält vermutlich Zugangsdaten und ist für den Agenten gesperrt (.env, Keys, Credentials). Bitte manuell prüfen.';
  }
  switch (name) {
    case 'list_dir': {
      const rel = args.path || '.';
      const absPath = abs(root, rel);
      const entries = await s.fs.readDir(absPath);
      const skip = new Set(['node_modules', '.git', 'dist', '.next', 'bin', 'obj', '__pycache__']);
      return entries.filter((e: any) => !skip.has(e.name)).map((e: any) => `${e.isDir ? 'DIR ' : 'FILE'} ${toRel(root, e.path)}`).join('\n') || '(leer)';
    }
    case 'read_file': {
      const p = abs(root, args.path);
      let content: string;
      try { content = await s.fs.readFile(p, 400_000); }
      catch (e: any) {
        return `FEHLER: Datei nicht gefunden: ${args.path} (${String(e?.message || e).slice(0, 120)}). Verwende den EXAKTEN Pfad aus list_dir oder search_files — erfinde keine Unterordner wie „src/“. Liegt die Datei im Projekt-Root, ohne Verzeichnis angeben.`;
      }
      const lines = content.split('\n');
      const off = args.offset || 0, lim = args.limit || 400;
      const slice = lines.slice(off, off + lim);
      const numbered = slice.map((l, i) => `${String(off + i + 1).padStart(4)}| ${l}`).join('\n');
      return `Datei: ${toRel(root, p)} (${lines.length} Zeilen)\n${numbered}${off + lim < lines.length ? `\n… [${lines.length - off - lim} weitere Zeilen, offset=${off + lim}]` : ''}\n(Hinweis: Zeilennummern nur zur Orientierung — old_text OHNE Nummern angeben; für gezielte Zeilen replace_lines nutzen.)`;
    }
    case 'write_file': {
      const rel = args.path;
      const p = abs(root, rel);
      const existed = await s.fs.exists(root, rel);
      const oldText = existed ? await s.fs.readFile(p, 400_000).catch(() => null) : null;
      if (existed) await backupFile(root, rel);
      const dir = p.replace(/[\\/][^\\/]+$/, '');
      await s.fs.mkdir(dir, '');
      await s.fs.writeFile(p, args.content ?? '');
      // Rück-Verifikation: tatsächlich gespeicherte Bytes erneut lesen
      let verify = '';
      try {
        const reread = await s.fs.readFile(p, 2_000_000);
        verify = reread === String(args.content ?? '')
          ? ` — Rücklesen verifiziert (${reread.length} Zeichen)`
          : ` — WARNUNG: Rücklesen weicht vom geschriebenen Inhalt ab!`;
        if (/\.jsonc?$/i.test(String(rel)) && verify.includes('verifiziert')) {
          try { JSON.parse(reread); verify += ' — JSON-Syntax: gültig'; }
          catch (je: any) { verify += ` — FEHLER: JSON-Syntax ungültig: ${je.message}`; }
        }
        if (verify.includes('FEHLER')) return `FEHLER: ${rel} geschrieben, aber ${verify.trim()} — bitte korrigiere den Inhalt.`;
        if (oldText != null) onDiff?.({ path: rel, oldText: oldText.slice(0, 80_000), newText: String(args.content ?? '').slice(0, 80_000) });
      } catch { verify = ' — Rück-Verifikation nicht möglich'; }
      return `OK: ${rel} ${existed ? 'überschrieben (Backup angelegt)' : 'erstellt'} — ${String(args.content ?? '').split('\n').length} Zeilen${verify}`;
    }
    case 'delete_path': {
      const rel = args.path;
      await backupFile(root, rel);
      await s.fs.deletePath(root, rel);
      return `OK: ${rel} gelöscht (Backup angelegt)`;
    }
    case 'edit_file': {
      const p = abs(root, args.path);
      const content = await s.fs.readFile(p, 2_000_000);
      const oldT = String(args.old_text ?? '');
      const newT = String(args.new_text ?? '');
      if (!oldT) return 'FEHLER: old_text darf nicht leer sein.';
      // 1) Exakter Treffer
      let idx = content.indexOf(oldT);
      let matchLen = oldT.length;
      let fuzzy = false;
      // 2) Fallback: whitespace-tolerant (Einrückung/Leerzeichen egal), nur bei eindeutigem Treffer
      if (idx < 0) {
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = oldT.trim().split(/\s+/).filter(Boolean).map(esc);
        if (parts.length) {
          const re = new RegExp(parts.join('\\s+'), 'g');
          const matches = [...content.matchAll(re)];
          if (matches.length === 1) {
            idx = (matches[0] as any).index;
            matchLen = matches[0][0].length;
            fuzzy = true;
          }
        }
      }
      if (idx < 0) {
        // Zeilen-Hinweis: finde Zeilen, die den ersten markanten Token von
        // old_text enthalten — damit kann das Modell replace_lines nutzen.
        const token = oldT.trim().split(/\s+/).find(w => w.length >= 4 && /[a-zA-Z]/.test(w));
        let lineHint = '';
        if (token) {
          const tl = token.toLowerCase();
          const hits = content.split('\n').map((l: string, i: number) => l.toLowerCase().includes(tl) ? i + 1 : 0).filter(Boolean).slice(0, 5);
          if (hits.length) lineHint = `\nMögliche Zeilen mit „${token}“: ${hits.join(', ')} — nutze replace_lines(start_line, end_line, new_text) mit diesen Zeilennummern.`;
        }
        return `FEHLER: old_text nicht in Datei gefunden. Aktueller Dateiinhalt (erste 2000 Zeichen):\n${content.slice(0, 2000)}${lineHint}\n—— Wähle old_text EXAKT aus diesem Inhalt (auf Einrückung und Zeilenumbrüche achten) oder nutze replace_lines mit den Zeilennummern aus read_file.`;
      }
      if (!fuzzy && content.indexOf(oldT, idx + 1) >= 0) return 'FEHLER: old_text kommt mehrfach vor — präzisiere die Passage.';
      await backupFile(root, toRel(root, p));
      const expected = content.slice(0, idx) + newT + content.slice(idx + matchLen);
      await s.fs.writeFile(p, expected);
      // JSON-Rückverifikation: Syntax muss nach dem Schreiben gültig sein
      let verify = '';
      try {
        const reread = await s.fs.readFile(p, 2_000_000);
        verify = reread === expected ? ' — Rücklesen verifiziert' : ' — WARNUNG: gespeicherter Inhalt weicht ab!';
        if (/\.jsonc?$/i.test(String(args.path)) && verify.includes('verifiziert')) {
          try { JSON.parse(reread); verify += ' — JSON-Syntax: gültig'; }
          catch (je: any) { verify += ` — FEHLER: JSON-Syntax ungültig: ${je.message}`; }
        }
      } catch { verify = ' — Rück-Verifikation nicht möglich'; }
      if (verify.includes('FEHLER')) return `FEHLER: ${args.path} geschrieben, aber ${verify.trim()} — bitte korrigiere den Inhalt.`;
      onDiff?.({ path: toRel(root, p), oldText: content.slice(0, 80_000), newText: expected.slice(0, 80_000) });
      return `OK: ${toRel(root, p)} bearbeitet${fuzzy ? ' (whitespace-toleranter Treffer)' : ''} (Backup angelegt)${verify}`;
    }
    case 'replace_lines': {
      const p = abs(root, args.path);
      const content = await s.fs.readFile(p, 2_000_000);
      const flines = content.split('\n');
      const start = Math.floor(Number(args.start_line));
      const end = Math.floor(Number(args.end_line ?? args.start_line));
      if (!Number.isFinite(start) || start < 1 || start > flines.length) return `FEHLER: start_line ${args.start_line} ungültig — die Datei hat ${flines.length} Zeilen.`;
      if (!Number.isFinite(end) || end < start || end > flines.length) return `FEHLER: end_line ${args.end_line} ungültig — gültig wäre ${start} bis ${flines.length}.`;
      const newLines = String(args.new_text ?? '').split('\n');
      const expected = [...flines.slice(0, start - 1), ...newLines, ...flines.slice(end)].join('\n');
      await backupFile(root, toRel(root, p));
      await s.fs.writeFile(p, expected);
      let verify = '';
      try {
        const reread = await s.fs.readFile(p, 2_000_000);
        verify = reread === expected ? ' — Rücklesen verifiziert' : ' — WARNUNG: gespeicherter Inhalt weicht ab!';
        if (/\.jsonc?$/i.test(String(args.path)) && verify.includes('verifiziert')) {
          try { JSON.parse(reread); verify += ' — JSON-Syntax: gültig'; }
          catch (je: any) { verify += ` — FEHLER: JSON-Syntax ungültig: ${je.message}`; }
        }
      } catch { verify = ' — Rück-Verifikation nicht möglich'; }
      if (verify.includes('FEHLER')) return `FEHLER: ${args.path} geschrieben, aber ${verify.trim()} — bitte korrigiere den Inhalt.`;
      onDiff?.({ path: toRel(root, p), oldText: flines.slice(start - 1, end).join('\n').slice(0, 80_000), newText: newLines.join('\n').slice(0, 80_000) });
      return `OK: ${toRel(root, p)} — Zeilen ${start}–${end} ersetzt durch ${newLines.length} Zeile(n)${verify}`;
    }
    case 'set_json_value': {
      const rel = args.path;
      const p = abs(root, rel);
      let raw: string;
      try { raw = await s.fs.readFile(p, 2_000_000); }
      catch (e: any) {
        return `FEHLER: JSON-Datei nicht gefunden: ${rel} (${String(e?.message || e).slice(0, 120)}). Verwende den EXAKTEN Pfad aus search_files (z. B. „Ticket-System.json“) — ohne erfundene Unterordner.`;
      }
      let obj: any;
      try { obj = JSON.parse(raw); }
      catch (e: any) { return `FEHLER: ${rel} ist kein gültiges JSON (${e.message}). Datei-Anfang: ${raw.slice(0, 300)}`; }
      const keyPath = String(args.key || '').split('.').map((k: string) => k.trim()).filter(Boolean);
      if (!keyPath.length) return 'FEHLER: key darf nicht leer sein (z. B. "feedbackChannelId" oder "config.channelId").';
      // Wert-Typisierung: NUR true/false/null und kurze, sichere Zahlen werden
      // konvertiert — lange IDs/Ziffernfolgen bleiben IMMER Strings.
      let value: any = args.value;
      if (typeof value === 'string') {
        const t = value.trim();
        if (t === 'true' || t === 'false' || t === 'null') value = t === 'null' ? null : t === 'true';
        else if (/^-?\d{1,15}(\.\d+)?$/.test(t)) value = Number(t);
        else if ((t.length > 1 && t.startsWith('"') && t.endsWith('"')) || (t.length > 1 && t.startsWith("'") && t.endsWith("'"))) value = t.slice(1, -1);
      }
      const createMissing = args.create_missing !== false;
      let node = obj;
      for (let i = 0; i < keyPath.length - 1; i++) {
        const k = keyPath[i];
        if (node[k] == null || typeof node[k] !== 'object') {
          if (!createMissing) return `FEHLER: Schlüssel „${keyPath.slice(0, i + 1).join('.')}“ existiert nicht in ${rel}.`;
          node[k] = {};
        }
        node = node[k];
      }
      const lastKey = keyPath[keyPath.length - 1];
      const existed = Object.prototype.hasOwnProperty.call(node, lastKey);
      if (!existed && !createMissing) return `FEHLER: Schlüssel „${args.key}“ existiert nicht in ${rel}.`;
      const oldVal = existed ? node[lastKey] : '(neu)';
      await backupFile(root, toRel(root, p));
      node[lastKey] = value;
      const expected = JSON.stringify(obj, null, 2) + (raw.endsWith('\n') ? '\n' : '');
      await s.fs.writeFile(p, expected);
      try {
        const reread = await s.fs.readFile(p, 2_000_000);
        const parsed = JSON.parse(reread);
        let check: any = parsed;
        for (const k of keyPath) check = check?.[k];
        if (check !== value) return `FEHLER: ${rel} geschrieben, aber Rücklesen zeigt ${JSON.stringify(check)} statt ${JSON.stringify(value)} — bitte prüfen.`;
        onDiff?.({ path: toRel(root, p), oldText: raw.slice(0, 80_000), newText: expected.slice(0, 80_000) });
        return `OK: ${toRel(root, p)} — ${args.key}: ${JSON.stringify(oldVal)} → ${JSON.stringify(value)} (JSON gültig, Rücklesen verifiziert)`;
      } catch (e: any) { return `FEHLER: Rück-Verifikation fehlgeschlagen: ${e.message}`; }
    }
    case 'remember': {
      const scopeHash = root.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
      const scope = String(args.scope || '').toLowerCase() === 'global' ? 'global' : scopeHash;
      const kind = String(args.kind || 'notiz');
      const title = String(args.title || 'Notiz').slice(0, 200);
      const content = String(args.content || '');
      // verified=1 nur, wenn der Agent dies explizit auf echte Ergebnisse stützt
      const verified = args.verified === true ? 1 : 0;
      run('INSERT INTO knowledge (id, scope, kind, title, content, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), scope, kind, title, content, verified, Date.now()]);
      return `OK: gespeichert (${kind}: ${title}${verified ? ', verifiziert' : ''})`;
    }
    case 'recall': {
      const scopeHash = root.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
      const q = `%${String(args.query || '').toLowerCase()}%`;
      const kind = args.kind ? String(args.kind) : null;
      // Projekt-Wissen UND globales, geteiltes Wissen durchsuchen
      const rows = kind
        ? query<any>('SELECT title, kind, content, verified, created_at FROM knowledge WHERE (scope=? OR scope=\'global\') AND kind=? AND lower(content||title) LIKE ? ORDER BY verified DESC, created_at DESC LIMIT 10', [scopeHash, kind, q])
        : query<any>('SELECT title, kind, content, verified, created_at FROM knowledge WHERE (scope=? OR scope=\'global\') AND lower(content||title) LIKE ? ORDER BY verified DESC, created_at DESC LIMIT 10', [scopeHash, q]);
      if (!rows.length) return 'Keine passenden Einträge in der Wissensdatenbank.';
      return rows.map((r: any) => `[${r.kind}${r.verified ? ' ✓verifiziert' : ''}] ${r.title}\n${r.content}`).join('\n---\n');
    }
    case 'rename_path': {
      await s.fs.renamePath(root, args.from, args.to);
      return `OK: ${args.from} → ${args.to}`;
    }
    case 'mkdir': {
      await s.fs.mkdir(root, args.path);
      return `OK: Verzeichnis ${args.path} erstellt`;
    }
    case 'run_command':
    case 'run_test': {
      const cmd = String(args.command || '');
      const expectArg = String(args.expect ?? '');
      // Ein Test ohne erwartete Ausgabe ist KEIN Beweis — leeres expect
      // würde auf jede Ausgabe matchen (Schein-Test).
      if (!expectArg.trim()) return 'FEHLER: Ungültiger Testaufruf — NICHT ausgeführt. expect darf nicht leer sein: Ohne erwartete Ausgabe ist das Ergebnis kein Nachweis (Schein-Test). Setze expect auf den erwarteten Ausgabetext (z. B. expect="OK" oder expect="42") oder nutze run_command für reine Ausgabe.';
      if (DANGEROUS.test(cmd)) {
        const ok = onConfirm ? await onConfirm(cmd) : false;
        if (!ok) return 'ABGEBROCHEN: Der Nutzer hat diesen kritischen Befehl abgelehnt.';
      }
      const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      agentRuns.add(runId);
      let res;
      try {
        res = await s.term.run({ cwd: root, command: cmd, timeoutMs: 180000, runId });
      } finally {
        agentRuns.delete(runId);
      }
      const expect = name === 'run_test' ? expectArg : undefined;
      const expectExit = name === 'run_test' && typeof args.expect_exit === 'number' ? args.expect_exit : 0;
      // Erwartung NUR gegen die tatsächliche Ausgabe prüfen — niemals raten
      const stdout = res.stdout || '';
      const expectMet = expect === undefined ? undefined
        : res.code === expectExit && stdout.includes(expect);
      cmdLog?.push({
        id: `${auftragId || 'auftrag'}-c${(cmdLog?.length || 0) + 1}`,
        auftragId: auftragId || 'auftrag',
        command: cmd,
        code: res.code,
        killed: res.killed,
        timedOut: res.timedOut,
        expect,
        expectMet,
        stdout: stdout.slice(-50000),
        stderr: (res.stderr || '').slice(-50000),
        ts: Date.now(),
      });
      const out = stdout + (res.stderr ? '\n[stderr]\n' + res.stderr : '');
      const base = `Exit code: ${res.code}${res.killed ? ' (ABGEBROCHEN)' : res.timedOut ? ' (TIMEOUT)' : ''}\n${out.slice(-12000) || '(keine Ausgabe)'}`;
      if (name !== 'run_test') return base;
      // Assertions-Test: explizites PASS/FAIL gegen die reale Ausgabe
      if (res.killed || res.timedOut) return `TEST ABGEBROCHEN (exit ${res.code}).\n${base}`;
      const ok = expectMet === true;
      const verdict = ok
        ? `TEST BESTANDEN: Ausgabe enthält die Erwartung "${expect}" (exit ${res.code} = erwartet ${expectExit}).`
        : `TEST FEHLGESCHLAGEN: ${expectMet === false
            ? (res.code !== expectExit
                ? `Exit-Code ${res.code} ≠ erwartet ${expectExit}`
                : `Ausgabe enthält "${expect}" nicht — tatsächliche Ausgabe: ${JSON.stringify(stdout.trim().slice(0, 300))}`)
            : 'Erwartung konnte nicht geprüft werden.'}`;
      return `${verdict}\n${base}`;
    }
    case 'search_files': {
      const tree = await s.fs.listTree(root, { maxDepth: 8 });
      const q = String(args.query).toLowerCase();
      const sub = args.path ? toRel(root, abs(root, args.path)).toLowerCase() + '/' : '';
      const candidates: string[] = [];
      for (const n of tree) {
        if (n.isDir) continue;
        const npath = n.path.replace(/\\/g, '/');
        // .aistudio enthält nur Agent-Berichte — kein Projektwissen, Suchrauschen
        if (npath === '.aistudio' || npath.startsWith('.aistudio/') || npath.includes('/.aistudio/')) continue;
        if (sub && !npath.toLowerCase().includes(sub)) continue;
        if (/\.(png|jpg|jpeg|gif|webp|ico|zip|exe|dll|bin|wasm|mp[34]|woff2?)$/i.test(n.name)) continue;
        if (isProtectedPath(n.name)) continue; // keine Zugangsdaten in Suchergebnissen
        candidates.push(n.path);
        if (candidates.length >= 300) break; // Kostenbremse für große Projekte
      }
      // Paralleles Lesen in kleinen Batches — deutlich schneller als sequenziell
      const hits: string[] = [];
      const CHUNK = 8;
      outer: for (let i = 0; i < candidates.length; i += CHUNK) {
        const batch = candidates.slice(i, i + CHUNK);
        const contents = await Promise.all(batch.map(async (p) => {
          try {
            const st = await s.fs.stat(root, toRel(root, p));
            if (st.size > 400_000) return null;
            return await s.fs.readFile(p, 400_000);
          } catch { return null; }
        }));
        for (let k = 0; k < batch.length; k++) {
          const c = contents[k];
          if (c == null) continue;
          const idx = c.toLowerCase().indexOf(q);
          if (idx >= 0) {
            const line = c.slice(0, idx).split('\n').length;
            hits.push(`${toRel(root, batch[k])}:${line}`);
            if (hits.length >= 40) break outer;
          }
        }
      }
      if (!hits.length) {
        return 'Keine Treffer' + (args.path
          ? ' — Der angegebene Unterordner existiert möglicherweise nicht. Tipp: weglassen von path suchen (gesamtes Projekt) oder zuerst list_dir nutzen.'
          : ' — Tipp: anderen Suchbegriff versuchen oder den Dateinamen statt des Inhalts suchen (z. B. list_dir).');
      }
      return hits.join('\n') + '\n(Treffer = Datei:Zeile — zum Bearbeiten genau diesen Pfad verwenden)';
    }
    case 'project_overview': {
      const tree = await s.fs.listTree(root, { maxDepth: 6 });
      const topDirs = new Map<string, number>();
      const exts = new Map<string, number>();
      const manifests: string[] = [];
      const LANG: Record<string, string> = {
        '.js': 'JavaScript', '.jsx': 'JavaScript/React', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
        '.ts': 'TypeScript', '.tsx': 'TypeScript/React', '.py': 'Python', '.java': 'Java',
        '.c': 'C', '.h': 'C/C++', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++', '.cs': 'C#',
        '.rs': 'Rust', '.go': 'Go', '.php': 'PHP', '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS',
        '.scss': 'SCSS', '.sql': 'SQL', '.lua': 'Lua', '.kt': 'Kotlin', '.kts': 'Kotlin',
        '.swift': 'Swift', '.dart': 'Dart', '.sh': 'Bash', '.bash': 'Bash', '.ps1': 'PowerShell',
        '.vue': 'Vue', '.svelte': 'Svelte', '.rb': 'Ruby', '.ex': 'Elixir', '.exs': 'Elixir', '.zig': 'Zig',
      };
      const MANIFEST = /^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|manage\.py|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|Cargo\.toml|go\.(mod|sum)|composer\.(json|lock)|pubspec\.yaml|Gemfile|CMakeLists\.txt|Makefile|Dockerfile|docker-compose\.ya?ml|tsconfig\.json|.*\.(csproj|sln|fsproj|vbproj)|\.gitignore|\.env\.example)$/i;
      const projFiles = tree.filter((n: any) => !n.isDir).length;
      for (const n of tree as any[]) {
        const rel = toRel(root, n.path).replace(/\\/g, '/');
        if (n.isDir) {
          const depth = rel.split('/').length;
          if (depth <= 2) topDirs.set(rel, (topDirs.get(rel) || 0) + 1);
          continue;
        }
        if (MANIFEST.test(n.name)) manifests.push(rel);
        const ext = n.name.includes('.') ? n.name.slice(n.name.lastIndexOf('.')).toLowerCase() : '';
        const lang = LANG[ext];
        if (lang) exts.set(lang, (exts.get(lang) || 0) + 1);
      }
      const langStr = [...exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, c]) => `${l} (${c})`).join(', ') || 'keine erkannt';
      const dirStr = [...topDirs.entries()].slice(0, 30).map(([d, c]) => `${d}: ${c}`).join(', ') || '(flache Struktur)';
      const hasGit = (tree as any[]).some(n => n.name === '.git');
      return `Projektüberblick (${projFiles} Dateien):\n- Verzeichnisse: ${dirStr}\n- Sprachen: ${langStr}\n- Build-/Dep-Dateien: ${manifests.slice(0, 30).join(', ') || 'keine'}\n- Git-Repo: ${hasGit ? 'ja' : 'nein'}`;
    }
    case 'git_status': {
      const runGit = async (cmd: string) => {
        try {
          const r = await s.term.run({ cwd: root, command: `git ${cmd}`, timeoutMs: 30000 });
          return r.code === 0 ? (r.stdout || '(leer)').slice(0, 6000) : `FEHLER (exit ${r.code}): ${(r.stderr || r.stdout || '').slice(0, 400)}`;
        } catch (e: any) { return `FEHLER: ${String(e?.message || e).slice(0, 300)}`; }
      };
      const branch = await runGit('rev-parse --abbrev-ref HEAD');
      if (/FEHLER/.test(branch)) return `Kein Git-Repository oder git nicht verfügbar: ${branch}`;
      const status = await runGit('status --short --branch');
      const log = await runGit('log --oneline -5');
      const diffstat = `${await runGit('diff --stat HEAD')}${await runGit('diff --stat --cached')}`;
      return `Git-Status (Branch: ${branch.trim()}):\n\n[status]\n${status}\n[letzte Commits]\n${log}\n[diff-stat]\n${diffstat}`;
    }
    case 'web_search': {
      const q = encodeURIComponent(String(args.query || ''));
      const html = await (await fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, { signal: AbortSignal.timeout(15000) })).text();
      const results: string[] = [];
      const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && results.length < 6) {
        const url = m[1].replace(/&amp;/g, '&');
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        results.push(`- ${title}\n  ${url}`);
      }
      return results.length ? results.join('\n') : 'Keine Suchergebnisse (Netzwerk/Blockade?)';
    }
    case 'fetch_url': {
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) return 'FEHLER: Nur http(s)-URLs erlaubt.';
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'AIStudio/1.0' } });
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text.slice(0, 8000) || '(leerer Inhalt)';
    }
    default:
      return `FEHLER: Unbekanntes Werkzeug: ${name}`;
  }
}

/** Extrahiert Tool-Aufrufe, die schwache Modelle als JSON-Text statt tool_calls ausgeben. */
export function parseJsonToolCall(content: string): { name: string; arguments: any } | null {
  return parseJsonToolCalls(content)[0] || null;
}

/** Extrahiert Tool-Aufrufe im <function-name>/<arguments>-Format, das schwache
 *  Modelle (v. a. über llama.cpp/llama-server) statt tool_calls ausgeben. */
export function parseFunctionTagCalls(content: string): { name: string; arguments: any }[] {
  const out: { name: string; arguments: any }[] = [];
  const re = /<function-name>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*<\/function-name>\s*<arguments>\s*([\s\S]*?)<\/arguments>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) && out.length < 8) {
    let args: any = {};
    try { args = JSON.parse(m[2].trim()); } catch { /* ungueltige Argumente → leeres Objekt */ }
    if (typeof args !== 'object' || args === null) args = {};
    out.push({ name: m[1], arguments: args });
  }
  return out;
}

/** Extrahiert ALLE Tool-Aufrufe, die schwache Modelle als JSON-Text ausgeben (mehrere Blöcke möglich). */
export function parseJsonToolCalls(content: string): { name: string; arguments: any }[] {
  const out: { name: string; arguments: any }[] = [];
  const nameRe = /"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(content)) && out.length < 8) {
    const name = m[1];
    // Suche das Argument-Objekt NACH diesem name-Vorkommen
    const rest = content.slice(m.index);
    const argKey = rest.match(/"(?:arguments|parameters|args)"\s*:\s*/);
    if (!argKey || argKey.index === undefined) { nameRe.lastIndex = m.index + m[0].length; continue; }
    const start = m.index + argKey.index + argKey[0].length;
    const ch = content[start];
    let end = -1;
    const scan = (open: string, close: string) => {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < content.length; i++) {
        const c = content[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = !inStr;
        if (inStr) continue;
        if (c === open) depth++;
        else if (c === close) { depth--; if (depth === 0) { end = i + 1; return; } }
      }
    };
    if (ch === '{') scan('{', '}');
    else if (ch === '[') scan('[', ']');
    else {
      const sm = content.slice(start).match(/^("[^"]*"|-?\d+(?:\.\d+)?|true|false|null)/);
      if (sm) end = start + sm[0].length;
    }
    if (end < 0) { nameRe.lastIndex = m.index + m[0].length; continue; }
    const raw = content.slice(start, end);
    // Schwache Modelle erzeugen oft Kommentare (//...) oder trailing commas im
    // JSON — nacheinander entfernnen und erneut versuchen.
    // Kommentar-Entfernung nur nach Komma oder Zeilenanfang — // in
    // String-Werten (z. B. URLs) bleibt unberührt.
    const stripComments = (t: string) => t
      .replace(/,\s*\/\/[^\n]*/g, ',')
      .replace(/\n[ \t]*\/\/[^\n]*/g, '\n');
    const candidates = [
      raw,
      raw.replace(/\\'/g, "'"),
      stripComments(raw),
      raw.replace(/,\s*([}\]])/g, '$1'),
      stripComments(raw).replace(/,\s*([}\]])/g, '$1'),
    ];
    for (const candidate of candidates) {
      try {
        const args = JSON.parse(candidate);
        if (typeof args === 'object' && args !== null) { out.push({ name, arguments: args }); break; }
      } catch { /* ignore */ }
    }
    nameRe.lastIndex = end; // hinter diesem Aufruf weitersuchen
  }
  return out;
}

const SYSTEM = `Du bist ein Coding-Agent in einer Desktop-IDE. Du arbeitest AUSSCHLIESSLICH im freigegebenen Projektordner des Nutzers.
Verwende die bereitgestellten Werkzeuge, um Dateien zu lesen, zu schreiben, zu löschen, umzubenennen und Terminalbefehle auszuführen.
Regeln:
- Arbeite nur innerhalb des Projektordners. Verwende AUSSCHLIESSLICH relative Pfade (z. B. „src/index.js") — niemals absolute Pfade, Laufwerksbuchstaben oder Prefixe wie „Projekt:“.
- Lies Dateien, bevor du sie änderst. Verstehe den Kontext mehrerer Dateien.
- Schreibe vollständige, lauffähige Dateien — keine Platzhalter.
- Bevorzuge kleine, gezielte Änderungen.
- Nach Änderungen: die geänderte Datei erneut lesen (Rück-Verifikation zeigt die Werkzeuge bereits), Syntax prüfen (z. B. python -m py_compile, node --check, tsc --noEmit) UND echte Funktionstests ausführen.
- Für Funktionstests IMMERVorrang für run_test mit konkreter erwarteter Ausgabe (z. B. expect="42") — ein Exit-Code 0 allein beweist nicht, dass die Funktion korrekt ist.Teste die im Auftrag geforderten Beispiele UND Grenzfälle.
- Vergleiche die tatsächliche Ausgabe mit der Anforderung. Weicht sie ab, ist der Test fehlgeschlagen — melde das ehrlich und repariere.
- Melde eine Aufgabe erst als erfolgreich, wenn die Prüfungen tatsächlich liefen — unterscheide „getestet", „teilweise getestet" und „nicht getestet".
- Bei Projektstart: nutze „recall“, um gespeichertes Wissen über dieses Projekt UND geteiltes globales Wissen abzurufen. Speichere wichtige Erkenntnisse mit „remember“ — scope=„global“ für übertragbares Wissen (Sprachen, Frameworks, allgemeine Lösungen), scope=„projekt“ für projektspezifisches. verified=1 nur für Wissen, das du durch echte Werkzeug-Ergebnisse (bestandene Tests, bestätigte Fixes) belegt hast — niemals für Vermutungen.
- Antworte am Ende kurz zusammenfassend auf Deutsch, was du geändert hast. Bei Such-/Analyseaufträgen nenne immer den TATSÄCHLICHEN Dateipfad aus dem Werkzeugergebnis — niemals einen geratenen.
- VERBOTEN: Bei Programmier-/Änderungsaufträgen NIEMALS Code als Markdown-Codeblock in der Antwort ausgeben — das ist keine Umsetzung. Code gehört ausschließlich über write_file/edit_file/replace_lines in die Dateien. Deine Antwort beschreibt nur, was die Werkzeuge getan haben.
- Verwende NUR die bereitgestellten Werkzeugnamen — erfinde keine (z. B. kein „replace_in_file" oder „create_new_file"; zum Ändern write_file mit dem kompletten Inhalt nutzen).
- Behaupte keine Änderung, die du nicht tatsächlich per Werkzeug ausgeführt hast.
- Führe bei Bedarf einen Befehl pro Antwort aus und warte auf das Ergebnis.
- Antworte NIEMALS mit erfundenen <tool_response>-Blöcken oder behaupteten Ausgaben — Tool-Ergebnisse liefert nur das System. Schreibst du einen Befehl, muss er über das run_command-Werkzeug laufen.
- Führe Tests NIEMALS nur als Text oder in Codeblöcken „aus" — das ist keine Ausführung. Ein Test ist erst dann gelaufen, wenn du das Werkzeug run_test (mit erwarteter Ausgabe) oder run_command wirklich aufgerufen hast und das echte Ergebnis gelesen hast.
- Führe keine Versionskontroll-Befehle aus (kein git commit/push/reset), wenn der Nutzer sie nicht ausdrücklich verlangt hat.
- Du bist ein vollständiger Entwickler-Agent: Du kannst neue Features, Dateien, Ordner, Skripte und ganze Programme selbstständig erstellen — der Code landet wirklich im Projekt, nicht nur im Chat.
- Arbeitsweise bei Programmieraufträgen: (1) Anforderungen verstehen, (2) bei größeren Aufträgen oder Projektstart ZUERST project_overview aufrufen (ein Aufruf liefert Struktur, Sprachen, Build-Dateien), sonst list_dir/read_file/search_files, (3) kurze Vorgehensweise nennen, (4) Code mit write_file/edit_file/mkdir schreiben — mehrere Dateien bei Bedarf in einem Schritt, (5) mit run_command testen und Fehler reparieren, (6) am Ende kurz auf Deutsch erklären, was erstellt/geändert wurde.
- Unterstützte Sprachen: JavaScript/TypeScript, Python, Java, C/C++, C#, Rust, Go, PHP, HTML/CSS, SQL, Lua, Kotlin, Swift, Dart, Bash/PowerShell und weitere — Syntax-Checks und Tests nutzen die jeweils passende Laufzeit (node, python, javac, go, cargo, dotnet o. ä., falls installiert).
- Erkenne Abhängigkeiten aus package.json, requirements.txt, pom.xml, Cargo.toml, go.mod u. a. Installiere NIE Pakete ohne ausdrückliche Bestätigung des Nutzers — melde fehlende Abhängigkeiten stattdessen.
- Git: git_status ist ein sicheres Lese-Werkzeug (Branch, Status, Diff-Stat, letzte Commits) — für Analyse nutzen. Mutationen (commit, push, checkout, reset, clean) nur über run_command UND nur wenn der Nutzer sie ausdrücklich verlangt — sie erfordern seine Bestätigung.
- Berücksichtige Imports, Abhängigkeiten und bestehende Konventionen des Projekts. Lies relevante Dateien, bevor du sie änderst.
- Wenn search_files einen Treffer in einer Datei zeigt, bearbeite GENAU diese Datei (Pfad aus dem Suchergebnis übernehmen) — erfinde niemals Pfade wie „config.json“, wenn die Einstellung in „config/settings.json“ liegt. Lies die gefundene Datei zuerst mit read_file.
- Für kleine Änderungen an bestehenden Dateien (Wert tauschen, Zeile ergännen, Text ersetzen) IMMER edit_file verwenden — niemals write_file, das würde die gesamte Datei mit unvollständigem Inhalt überschreiben.
- JSON-Konfigurationen (Schlüssel-Wert ändern, z. B. „feedbackChannelId auf X setzen"): BEVORZUGT set_json_value verwenden — es braucht keinen exakten alten Text, validiert JSON und prüft den Wert per Rücklesen. edit_file nur für Text-Änderungen außerhalb von JSON-Werten.
- Für Änderungen an bekannten Zeilen BEVORZUGT replace_lines verwenden: lies die Datei mit read_file (Zeilennummern sichtbar), gib start_line/end_line und den kompletten Ersatztext an — kein altes Text-Snippet nötig, daher zuverlässiger als edit_file.
- edit_file nur verwenden, wenn du old_text EXAKT aus dem read_file-Ergebnis kopieren kannst (ohne Zeilennummern, mit korrekter Einrückung). Erfinde niemals Dateiinhalt.
- run_test: expect muss die EXAKTE erwartete Ausgabe der geprüften Funktion enthalten (z. B. expect="subtrahiere(5,3)= 2"), nicht nur irgendeine Zahl — eine schwache Erwartung wie expect="5" erkennt falsche Ergebnisse nicht. Prüfe bei mehreren Funktionen ALLE relevanten Ausgaben.
- Bevor du eine bestehende Datei mit edit_file oder write_file änderst, MUSST du sie in diesem Auftrag zuerst vollständig mit read_file gelesen haben — das System blockiert Änderungen an ungelesenen Dateien.
- Bei edit_file-Fehlern („old_text nicht gefunden“) enthält die Fehlermeldung den aktuellen Dateianfang — wähle old_text daraus EXAKT (inkl. Einrückung/Zeilenumbrüche) und versuche es erneut, statt Erfolg zu behaupten.
- JSON-Dateien: nach dem Schreiben prüft das Werkzeug automatisch die Syntax — ein „FEHLER: JSON-Syntax ungültig" bedeutet, die Datei wurde geschrieben, ist aber kaputt und muss sofort korrigiert werden.
- Eine Konfigurationsänderung gilt erst als erledigt, wenn du die Datei danach erneut mit read_file gelesen hast und der NEUE Wert tatsächlich im Inhalt steht. Behaupte niemals Erfolg ohne diesen Nachweis.
- Schlägt ein Werkzeugaufruf fehl (Ergebnis beginnt mit FEHLER/Fehler), analysiere die Ursache und versuche es mit korrigierten Argumenten — rate nicht einfach eine andere Datei.
- Lies niemals .env-Dateien oder Dateien mit Zugangsdaten — sie sind für dich gesperrt. Gib keine Secrets aus.
- Wenn du unsicher bist oder etwas Gefährliches nötig ist, frage nach statt zu raten.`;

export async function runAgent(opts: AgentOpts): Promise<AgentResult> {
  const { projectRoot, history, userMessage, onEvent, onConfirmCommand, signal } = opts;
  const empty: AgentResult = { changedFiles: [] };
  let settings = opts.settings;
  // Provider „local“: Model-Router wählt das passende GGUF-Modell
  if (settings.provider === 'local') {
    try {
      const { effectiveSettings } = await import('./llm');
      settings = await effectiveSettings(settings, 'code');
    } catch (e: any) {
      onEvent({ type: 'error', text: e.message });
      return empty;
    }
  }
  const provider = settings.provider;
  if (!['ollama', 'custom', 'openai'].includes(provider)) {
    onEvent({ type: 'error', text: 'Unbekannter Provider.' });
    return empty;
  }
  const model = provider === 'ollama' ? settings.ollamaModel
    : provider === 'openai' ? settings.openaiModel
    : settings.customModel;
  const baseUrl = provider === 'ollama' ? settings.ollamaUrl
    : provider === 'openai' ? 'https://api.openai.com/v1'
    : settings.customUrl;
  const apiKey = provider === 'openai' ? settings.openaiKey : settings.customKey;
  if (!model) {
    onEvent({ type: 'error', text: 'Kein Modell ausgewählt. Bitte in den Einstellungen ein Modell konfigurieren.' });
    return empty;
  }
  if (!baseUrl) {
    onEvent({ type: 'error', text: 'Kein API-Endpunkt konfiguriert. Bitte in den Einstellungen den Provider-URL eintragen.' });
    return empty;
  }

  // Sandbox-Modus: vollständige Kopie des Projekts — der Agent arbeitet in der
  // Kopie, das Original bleibt bis zur expliziten Übernahme unverändert.
  let sandboxRoot: string | undefined;
  let workRoot = projectRoot;
  if (opts.sandbox) {
    try {
      const copy = await createSandboxCopy(projectRoot);
      if (!copy) {
        onEvent({ type: 'error', text: 'Sandbox konnte nicht erstellt werden (Projekt leer oder zu groß) — Auftrags abgebrochen, Original unverändert.' });
        return empty;
      }
      sandboxRoot = copy;
      workRoot = copy;
      onEvent({ type: 'sandbox', text: copy });
    } catch (e: any) {
      onEvent({ type: 'error', text: `Sandbox-Fehler: ${e.message} — Auftrags abgebrochen, Original unverändert.` });
      return empty;
    }
  }

  const doStep = (msgs: AgentMessage[], tools: ToolDef[], onTok: (t: string) => void) =>
    provider === 'ollama'
      ? ollamaAgentStep(settings.ollamaUrl, settings.ollamaModel, msgs, tools, onTok, signal)
      : openAIToolStep(baseUrl, apiKey, model, msgs, tools, onTok, signal);

  const messages: AgentMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\nProjektordner: ${workRoot}${opts.projectName ? ` (Projekt: ${opts.projectName})` : ''}${sandboxRoot ? `\n(Hinweis: Dies ist eine Sandbox-Arbeitskopie — teste und ändere hier; das Original wird nur nach deiner Freigabe aktualisiert.)` : ''}` },
    ...history.slice(-20).map(m => ({ role: m.role as any, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // Bei Abbruch: alle laufenden Agent-Befehle samt Unterprozessen beenden
  const onAbort = () => {
    for (const id of agentRuns) { try { (window as any).studio?.term?.kill(id); } catch {} }
    agentRuns.clear();
  };
  signal?.addEventListener('abort', onAbort);

  // Endlosschleifen-Schutz: identische Tool-Aufrufe werden gezählt
  const failCounts = new Map<string, number>();
  // Verifikations-Protokoll: NUR echte Tool-Ergebnisse gelten als Nachweis
  const auftragId = `a${Date.now().toString(36)}`;
  const cmdLog: CmdRecord[] = [];
  const changedFiles = new Set<string>();
  // Auftrag verlangt eine Dateiänderung? (Suche/Analyse allein reicht nicht)
  const CHANGE_INTENT = /(änder|bearbeit|erstell|schreib|ersetze|ersetzen|konfigurier|aktualisier|fix|reparier|beheb|hinzufüg|entfern|lösch|umbenenn|verschieb|optimier|verbesser|erweitere|implementier|anpass|korrektur|wert|einstellung|konfiguration|variable|parameter)/i.test(userMessage);
  let invalidTestCalls = 0;
  let repairFails = 0;
  let testNudges = 0;
  let codeNudges = 0;
  let repairNudges = 0;
  let autoCmdRuns = 0;
  let lastContentNorm = '';
  let fakeResponses = 0;
  let finalText = '';
  let finishedText: string | null = null;
  let hadError = false;
  // Dateien, die in DIESEM Auftrag erfolgreich gelesen wurden —
  // Änderungen an bestehenden Dateien sind nur danach erlaubt.
  const readFiles = new Set<string>();
  const normRel = (p: any) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
  // Fehlgeschlagene Änderungsversuche pro Datei (max. 3 → Abbruch)
  const fileFailCounts = new Map<string, number>();
  let maxFileFails = 0;
  try {
    for (let iter = 0; iter < 20; iter++) {
      if (signal?.aborted) { onEvent({ type: 'done', text: '*(Vom Nutzer abgebrochen.)*' }); return { sandboxRoot, changedFiles: [...changedFiles] }; }
      const msg = await doStep(messages, TOOLS, (t) => onEvent({ type: 'token', text: t }));
      messages.push(msg);

      // Wiederholungs-Schutz: identische Modell-Antworten hintereinander → abbrechen
      if (msg.content) {
        const norm = msg.content.replace(/\s+/g, ' ').trim().slice(0, 500);
        if (norm === lastContentNorm) {
          finishedText = finalText + '\n\n*(Abgebrochen: Das Modell wiederholt sich ohne Fortschritt.)*';
          break;
        }
        lastContentNorm = norm;
      } else {
        lastContentNorm = '';
      }

      // Fallback: Modell hat Tool-Aufrufe als JSON-Text oder <function-name>-Tags
      // ausgegeben (alle Blocks!)
      if ((!msg.tool_calls || msg.tool_calls.length === 0) && provider !== 'ollama') {
        const parsedAll = parseJsonToolCalls(msg.content || '');
        const tagCalls = parseFunctionTagCalls(msg.content || '');
        const merged = parsedAll.length ? parsedAll : tagCalls;
        if (merged.length) {
          msg.tool_calls = merged.map((p, i) => ({ id: `json-${i}`, function: { name: p.name, arguments: p.arguments } } as any));
          msg.content = '';
        }
      }
      // Erfundene Tool-Antworten des Modells aus dem anzuzeigenden Text entfernen
      const cleanContent = (msg.content || '').replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, '').trim();
      if (cleanContent) finalText += cleanContent + '\n';

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Schwache Modelle schreiben Befehle als Text statt als Tool-Aufruf.
        // Erkennen und ausführen — aber IMMER mit ausdrücklicher Nutzer-Freigabe.
        // Codeblöcke (```) gelten ausdrücklich NICHT als Ausführungsauftrag.
        if (autoCmdRuns < 2 && msg.content && onConfirmCommand) {
          // Codeblöcke werden entfernt, bevor nach Befehlen gesucht wird —
          // ein ```-Block ist kein automatischer Ausführungsauftrag.
          const plainText = msg.content
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, ' ')
            .replace(/<function-name>[\s\S]*?<\/arguments>/gi, ' ')
            .replace(/<arguments>[\s\S]*?<\/arguments>/gi, ' ');
          const m = plainText.match(/(?:run_command|run_test)\(\s*["'`]([^"'`]+)["'`]\s*[,)]/i)
            || plainText.match(/(?:^|\n)\s*((?:node|python3?|npm|npx|pytest|jest|vitest|go|cargo|dotnet|php)\s+[^\n]{0,300})/i)
            || plainText.match(/\b((?:node|python3?|npm|npx|pytest)\s+-e\s+"[^"]{1,300}"|(?:node|python3?)\s+[\w./\\-]+\.(?:js|mjs|cjs|py)\b[^\n]{0,200})/i);
          // Nur die erste Zeile verwenden und bei Backtick/Anführungszeichen
          // abbrechen — Modelle hängen sonst Text wie „` aus und überprüfe…"
          // oder die erwartete Ausgabe an den Befehl an.
          const cmdText = m?.[1]?.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'))
            ?.split('`')[0].trim().slice(0, 400);
          if (cmdText && cmdText.length < 500) {
            autoCmdRuns++;
            // Ausdrückliche Freigabe für JEDEN text-erkannten Befehl
            const approved = await onConfirmCommand(`[Automatisch aus Modell-Text erkannt] ${cmdText}`);
            if (!approved) {
              const msg2 = 'ABGEBROCHEN: Der aus dem Modelltext erkannte Befehl wurde nicht freigegeben.';
              onEvent({ type: 'tool', name: 'run_command', args: { command: cmdText, autoFromText: true }, result: msg2, ok: false });
              messages.push({ role: 'tool', tool_call_id: `autocmd-${autoCmdRuns}`, content: msg2 });
              continue;
            }
            try {
              const result = await execTool('run_command', { command: cmdText }, workRoot, onConfirmCommand, cmdLog, auftragId);
              onEvent({ type: 'tool', name: 'run_command', args: { command: cmdText, autoFromText: true }, result: result.slice(0, 4000), ok: !/^fehler|^abgebrochen/i.test(result) });
              messages.push({ role: 'tool', tool_call_id: `autocmd-${autoCmdRuns}`, content: result });
              continue;
            } catch (e: any) {
              messages.push({ role: 'tool', tool_call_id: `autocmd-${autoCmdRuns}`, content: `Fehler: ${e.message}` });
              continue;
            }
          }
        }
        // Fabrication-Guard: Antwort besteht nur aus erfundenen Tool-Blöcken
        const stripped = (msg.content || '').replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, '').replace(/```[\s\S]*?```/g, '').trim();
        if (!stripped && /<tool_response>/i.test(msg.content || '')) {
          fakeResponses++;
          if (fakeResponses >= 2) {
            finishedText = finalText + '\n\n*(Abgebrochen: Das Modell hat wiederholt erfundene Tool-Antworten ausgegeben, ohne Werkzeuge auszuführen.)*';
            break;
          }
          messages.push({ role: 'user', content: 'Systemhinweis: Deine <tool_response>-Blöcke sind erfunden — sie kommen nicht vom System. Echtes Feedback erhältst du nur über echte Werkzeugaufrufe. Bitte führe die nötigen Werkzeuge jetzt wirklich aus oder erkläre die Ursache.' });
          continue;
        }
        fakeResponses = 0;
        // Automatischer Test-Nachschub: Dateien wurden geändert, aber es lief
        // noch kein Funktionstest — nachhaken, statt dem Modell zu glauben.
        // Wenn das Modell sogar einen Testerfolg BEHAUPTET, obwohl kein
        // Testlauf protokolliert ist, wird die Korrektur verschärft.
        const funcRan = cmdLog.some(c => !c.auto && TEST_CMD_RE.test(c.command));
        const claimsSuccess = /(test|prüfung|run_test|ausgabe)[\s\S]{0,120}(bestanden|erfolgreich|korrekt|stimmt|überein)|((bestanden|erfolgreich|korrekt)[\s\S]{0,60}(test|prüfung))/i.test(msg.content || '');
        if (changedFiles.size > 0 && !funcRan && testNudges < 2 && iter < 18) {
          testNudges++;
          messages.push({
            role: 'user',
            content: claimsSuccess
              ? 'Systemhinweis (wichtig): Du behauptest einen bestandenen Test, aber im Protokoll ist KEIN Testlauf vorhanden. Das ist nicht erlaubt. Führe JETZT ein echtes Werkzeug aus: run_test mit command und expect (erwarteter Ausgabe-Wert), lies das echte Ergebnis und berichte danach ehrlich.'
              : 'Systemhinweis: Du hast Dateien geändert, aber noch keinen Funktionstest ausgeführt (ein Syntax-Check reicht nicht). Führe jetzt mit run_test einen Test mit erwarteter Ausgabe aus (z. B. expect="42") oder run_command, prüfe die Ausgabe und bewerte das Ergebnis ehrlich.',
          });
          continue;
        }
        // Code-nur-als-Text-Nudge: Das Modell schreibt Code in Markdown-
        // Codeblöcken, ohne jemals ein Schreib-Werkzeug aufzurufen — das
        // ändert nichts im Projekt. Einmal nachhaken, dann ehrlich beenden.
        if (CHANGE_INTENT && changedFiles.size === 0 && codeNudges < 2 && /```/.test(msg.content || '') && iter < 18) {
          codeNudges++;
          messages.push({
            role: 'user',
            content: 'Systemhinweis (wichtig): Du hast Code nur als Text geschrieben — das ändert NICHTS im Projekt. Schreibe den Code jetzt wirklich mit den Werkzeugen: write_file für neue Dateien, edit_file oder replace_lines für Änderungen an bestehenden Dateien (lies sie vorher mit read_file). Danach teste mit run_test.',
          });
          continue;
        }
        // Reparatur-Nudge: Der letzte Test/Befehl ist fehlgeschlagen — das
        // Modell bekommt EINEN Anstoß, Fehler zu beheben statt einfach
        // aufzuhören. Danach darf es ehrlich abschließen.
        const lastCmdFailed = (() => {
          const c = cmdLog[cmdLog.length - 1];
          return !!c && !c.auto && !c.killed && (c.code !== 0 || c.expectMet === false);
        })();
        if (lastCmdFailed && repairNudges < 1 && iter < 18) {
          repairNudges++;
          messages.push({
            role: 'user',
            content: 'Systemhinweis: Der letzte Test/Befehl ist FEHLGESCHLAGEN. Lies die Fehlerausgabe, analysiere die Ursache, lies die betroffene Datei erneut mit read_file, korrigiere sie (edit_file/replace_lines) und führe den Test erneut mit run_test aus — oder erkläre ehrlich, warum die Aufgabe nicht lösbar ist.',
          });
          continue;
        }
        finishedText = finalText;
        break;
      }

      for (const call of msg.tool_calls) {
        const name = call.function.name;
        let args = call.function.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        onEvent({ type: 'tool', name, args });
        const sig = name + ':' + JSON.stringify(args);
        const fails = failCounts.get(sig) || 0;
        if (fails >= 3) {
          const msg = 'FEHLER: Dieser identische Werkzeugaufruf ist bereits 3× fehlgeschlagen. Bitte wähle einen anderen Ansatz oder erkläre dem Nutzer die Ursache, statt es erneut zu versuchen.';
          onEvent({ type: 'tool', name, args, result: msg, ok: false });
          messages.push({ role: 'tool', tool_call_id: (call as any).id || name, content: msg });
          continue;
        }
        try {
          // Identischen bereits 2× erfolgreichen Befehl nicht erneut ausführen
          if ((name === 'run_command' || name === 'run_test') && typeof args?.command === 'string') {
            const prevOk = cmdLog.filter(c => !c.auto && c.command === args.command && c.code === 0).length;
            if (prevOk >= 2) {
              const last = [...cmdLog].reverse().find(c => c.command === args.command);
              const msg = `Dieser Befehl wurde bereits ${prevOk}× erfolgreich ausgeführt (Exit 0). Letzte Ausgabe: ${((last?.stdout || '') + (last?.stderr ? '\n' + last.stderr : '')).slice(0, 800) || '(keine)'}. Bitte führe ihn nicht erneut aus.`;
              onEvent({ type: 'tool', name, args, result: msg, ok: true });
              messages.push({ role: 'tool', tool_call_id: (call as any).id || name, content: msg });
              continue;
            }
          }
          // Read-first-Regel: edit_file und write_file auf EXISTIERENDE Dateien
          // sind nur erlaubt, wenn die Datei in diesem Auftrag gelesen wurde.
          // Deterministische Absicherung — ein geratener old_text kann so gar
          // nicht erst TRY-and-error ausarten.
          if ((name === 'edit_file' || name === 'write_file' || name === 'set_json_value' || name === 'replace_lines') && args && typeof args.path === 'string' && args.path) {
            try {
              const targetRel = normRel(args.path);
              const exists = await studio().fs.exists(workRoot, args.path);
              if (exists && !readFiles.has(targetRel)) {
                const blockMsg = `FEHLER: Datei „${args.path}“ wurde in diesem Auftrag noch nicht mit read_file gelesen. Lies sie zuerst komplett, identifiziere den tatsächlichen Inhalt und wiederhole die Änderung dann mit exakten Werten.`;
                onEvent({ type: 'tool', name, args, result: blockMsg, ok: false });
                messages.push({ role: 'tool', tool_call_id: (call as any).id || name, content: blockMsg });
                continue;
              }
            } catch { /* exists-Check fehlgeschlagen → normal weiter */ }
          }
          const result = await execTool(name, args || {}, workRoot, onConfirmCommand, cmdLog, auftragId,
            (d) => onEvent({ type: 'filediff', path: d.path, oldText: d.oldText, newText: d.newText, ts: Date.now() }));
          // Bei run_command/run_test entscheiden Exit-Code UND Erwartungserfüllung
          const lastCmd = (name === 'run_command' || name === 'run_test') ? cmdLog[cmdLog.length - 1] : null;
          const toolFailed = lastCmd
            ? (lastCmd.code !== 0 || !!lastCmd.killed || lastCmd.expectMet === false)
            : (/^fehler|^abgebrochen|^test fehlgeschlagen/i.test(result) || result.includes('nicht in Datei gefunden'));
          if (toolFailed) {
            failCounts.set(sig, fails + 1);
          } else {
            failCounts.delete(sig);
          }
          // Read-Tracking: erfolgreich gelesene Dateien für die Read-first-Regel
          if (name === 'read_file' && !toolFailed && args && typeof args.path === 'string') {
            readFiles.add(normRel(args.path));
          }
          // Änderungsversuche pro Datei zählen — nach 3 Fehlschlägen abbrechen
          if (name === 'edit_file' || name === 'write_file' || name === 'set_json_value' || name === 'replace_lines') {
            const fk = `${name}|${normRel(args?.path)}`;
            if (toolFailed) {
              const c = (fileFailCounts.get(fk) || 0) + 1;
              fileFailCounts.set(fk, c);
              if (c > maxFileFails) maxFileFails = c;
            } else {
              fileFailCounts.delete(fk);
            }
          }
          onEvent({ type: 'tool', name, args, result: result.slice(0, 4000), ok: !toolFailed });
          // Nur ERFOLGREICHE Schreibzugriffe gelten als Dateiänderung —
          // fehlgeschlagene Versuche dürfen den Bericht nicht verfälschen.
          if (!toolFailed && ['write_file', 'delete_path', 'rename_path', 'edit_file', 'set_json_value', 'replace_lines'].includes(name)) {
            let rel = String(args.path || args.from || args.to);
            try { rel = toRel(workRoot, abs(workRoot, rel)); } catch { /* unnormalisiert lassen */ }
            changedFiles.add(rel);
            onEvent({ type: 'filechange', text: rel });
          }
          // Zählt ungültige Testaufrufe (leer expect → nie als Test gewertet)
          if (name === 'run_test' && /nicht-leeren expect/.test(result)) invalidTestCalls++;
          // Reparatur-Versuch-Zähler: echte Testläufe mit Fehler (Exit≠0 oder verfehlte Erwartung)
          if (name === 'run_command' || name === 'run_test') {
            const last = cmdLog[cmdLog.length - 1];
            if (last && (last.code !== 0 || last.expectMet === false) && !last.killed) repairFails++;
            else if (last && last.code === 0 && last.expectMet !== false) repairFails = 0;
          }
          messages.push({ role: 'tool', tool_call_id: (call as any).id || name, content: result.slice(0, 8000) });
        } catch (e: any) {
          const err = `Fehler: ${e.message}`;
          onEvent({ type: 'tool', name, args, result: err, ok: false });
          messages.push({ role: 'tool', tool_call_id: (call as any).id || name, content: err });
        }
      }
      // Maximal 3 Reparaturversuche nach fehlgeschlagenen Testläufen
      if (repairFails >= 3) {
        finishedText = finalText + '\n\n*(Automatisch angehalten: 3 Testläufe in Folge fehlgeschlagen — bitte den Fehler manuell prüfen.)*';
        break;
      }
      // Ungültige run_test-Aufrufe (leeres expect) werden nicht endlos wiederholt
      if (invalidTestCalls >= 2) {
        finishedText = finalText + '\n\n*(Abgebrochen: run_test wurde wiederholt ohne expect-Wert aufgerufen — das ist kein gültiger Test. Bitte erwartete Ausgabe angeben.)*';
        break;
      }
      // Maximal 3 fehlgeschlagene Änderungsversuche an derselben Datei
      if (maxFileFails >= 3) {
        finishedText = finalText + '\n\n*(Abgebrochen: 3 Änderungsversuche an derselben Datei sind fehlgeschlagen — die Aufgabe gilt als NICHT erledigt. Bitte den Dateiinhalt prüfen und manuell vorgehen.)*';
        break;
      }
    }
    if (finishedText === null) {
      finishedText = finalText + '\n\n*(Maximale Schritte erreicht — Aufgabe ggf. unvollständig.)*';
    }
  } catch (e: any) {
    hadError = true;
    onEvent({ type: 'error', text: e.message || String(e) });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (hadError || signal?.aborted) return { sandboxRoot, changedFiles: [...changedFiles] };

  // ---------- Verifikation: NUR echte Werkzeug-Ergebnisse ----------
  const report = await buildVerificationReport(workRoot, changedFiles, cmdLog, onEvent, signal, auftragId);
  onEvent({ type: 'verify', text: report });

  // Claim-vs-Nachweis: Wenn der Auftrag eine Änderung verlangte, aber kein
  // Schreibzugriff erfolgreich rückgelesen wurde, ist die Aufgabe NICHT
  // verifiziert — unabhängig davon, was der Modelltext behauptet.
  const unverifiedClaim = !!(CHANGE_INTENT && changedFiles.size === 0);
  if (unverifiedClaim) {
    const claimsSuccess = /(erfolgreich|erledigt|geändert|erstellt|angepasst|abgeschlossen|fertig|implemented|done)/i.test(finishedText || '');
    finishedText += claimsSuccess
      ? '\n\n⚠ **Nachweis fehlt:** Der Text behauptet eine Änderung, aber kein Schreib-Werkzeug (write_file / edit_file / replace_lines / set_json_value) wurde erfolgreich ausgeführt und rückgelesen. **Diese Aufgabe gilt als NICHT verifiziert.**'
      : '\n\nℹ **Hinweis:** Für diesen Auftrag wurde keine Dateiänderung verifiziert (keine erfolgreichen Schreib-Werkzeugaufrufe).';
  }
  onEvent({ type: 'done', text: finishedText! + '\n\n' + report });
  // Bericht im Projekt ablegen (nachvollziehbar pro Auftrag)
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await studio().fs.writeFile(`${projectRoot}/.aistudio/berichte/agent-${ts}.md`, report);
    // Vollständiges Befehlsprotokoll (inkl. stdout/stderr) separat sichern
    await studio().fs.writeFile(
      `${projectRoot}/.aistudio/berichte/agent-${ts}-commands.json`,
      JSON.stringify({ auftragId, projectRoot, createdAt: new Date().toISOString(), commands: cmdLog }, null, 2),
    );
  } catch { /* Bericht ist optional */ }

  // Geprüftes Wissen in die gemeinsame Wissensbasis schreiben — NUR was auf
  // echten Werkzeug-Ergebnissen beruht (verified=1). So profitiert auch die
  // normale Chat-KI und andere Projekte von bestätigten Lösungen.
  try {
    const agentCmds = cmdLog.filter(c => !c.auto);
    if (agentCmds.length) {
      const funcOk = agentCmds.some(c => TEST_CMD_RE.test(c.command) && c.code === 0 && c.expectMet !== false);
      const anyFail = agentCmds.some(c => c.code !== 0 || c.expectMet === false);
      const kind = funcOk ? 'testergebnis' : anyFail ? 'fehler' : 'notiz';
      const scopeHash = projectRoot.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
      const files = [...changedFiles].join(', ') || 'keine';
      const cmds = agentCmds.map(c => `${c.command} → exit ${c.code}${c.expectMet === false ? ' (Erwartung verfehlt)' : ''}`).join('; ').slice(0, 400);
      const status = report.includes('bestanden') ? 'bestanden' : report.includes('Fehlgeschlagen') ? 'fehlgeschlagen' : 'nicht getestet';
      run('INSERT INTO knowledge (id, scope, kind, title, content, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), scopeHash, kind,
         `Agent-Auftrag ${auftragId}: ${userMessage.slice(0, 100)}`,
         `Dateien: ${files}. Ausgeführte Befehle: ${cmds}. Ergebnis: ${status}.`,
         1, Date.now()]);
    }
  } catch { /* Wissen ist optional */ }

  return { sandboxRoot, changedFiles: [...changedFiles], unverifiedClaim };
}

/**
 * Baut den Verifikationsbericht AUSSCHLIESSLICH aus echten Tool-Ergebnissen.
 * Führt für geänderte Dateien sichere Syntax-Checks automatisch aus
 * (python -m py_compile, node --check) — niemals Modellbehauptungen.
 */
export async function buildVerificationReport(
  root: string,
  changedFiles: Set<string>,
  cmdLog: CmdRecord[],
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  auftragIdArg?: string,
): Promise<string> {
  const s = studio();
  const lines: string[] = ['---', '### Verifikationsbericht', ''];

  // 1) Automatische Syntax-Checks für geänderte Dateien (sicher, deterministisch)
  const autoResults: { file: string; cmd: string; ok: boolean; detail: string }[] = [];
  for (const rel of changedFiles) {
    if (signal?.aborted) break;
    const ext = rel.split('.').pop()?.toLowerCase() || '';
    let checkCmd: string | null = null;
    if (ext === 'py') checkCmd = `python -m py_compile "${rel}"`;
    else if (['js', 'mjs', 'cjs'].includes(ext)) checkCmd = `node --check "${rel}"`;
    else if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) checkCmd = `npx tsc --noEmit --skipLibCheck --module esnext --target es2020 "${rel}"`;
    else if (['sh', 'bash'].includes(ext)) checkCmd = `bash -n "${rel}"`;
    else if (ext === 'json') checkCmd = `node -e "JSON.parse(require('fs').readFileSync('${rel.replace(/'/g, "\'")}','utf8'))"`;
    if (!checkCmd) continue;
    try {
      const exists = await s.fs.exists(root, rel);
      if (!exists) { autoResults.push({ file: rel, cmd: checkCmd, ok: false, detail: 'Datei nicht (mehr) vorhanden' }); continue; }
      const runId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      agentRuns.add(runId);
      let res;
      try {
        res = await s.term.run({ cwd: root, command: checkCmd, timeoutMs: 60000, runId });
      } finally {
        agentRuns.delete(runId);
      }
      cmdLog.push({
        id: `${auftragIdArg || 'auftrag'}-auto${cmdLog.length + 1}`,
        auftragId: auftragIdArg || 'auftrag',
        command: checkCmd, code: res.code, killed: res.killed, timedOut: res.timedOut, auto: true,
        stdout: (res.stdout || '').slice(-50000), stderr: (res.stderr || '').slice(-50000), ts: Date.now(),
      });
      onEvent({ type: 'tool', name: 'auto_check', args: { command: checkCmd }, result: `Exit ${res.code}`, ok: res.code === 0 });
      autoResults.push({
        file: rel, cmd: checkCmd, ok: res.code === 0,
        detail: res.code === 0 ? 'bestanden' : `fehlgeschlagen (exit ${res.code})${res.stderr ? ': ' + res.stderr.slice(0, 200) : ''}`,
      });
    } catch (e: any) {
      autoResults.push({ file: rel, cmd: checkCmd, ok: false, detail: `Fehler: ${e.message}` });
    }
  }

  // 2) Bericht zusammenstellen
  if (changedFiles.size) {
    lines.push(`**Geänderte Dateien:** ${[...changedFiles].join(', ')}`, '');
  }
  const agentCmds = cmdLog.filter(c => !c.auto);
  const autoCmds = cmdLog.filter(c => c.auto);
  if (agentCmds.length) {
    lines.push(`**Vom Agenten ausgeführte Befehle** (Auftrag: ${auftragIdArg || '—'}):`);
    for (const c of agentCmds) {
      const flag = c.killed ? ' (abgebrochen)' : c.timedOut ? ' (Timeout)' : c.code === 0 ? ' ✓' : ' ✗';
      const expectNote = c.expect !== undefined
        ? ` · Erwartung "${c.expect.slice(0, 60)}": ${c.expectMet === true ? '✓ erfüllt' : c.expectMet === false ? '✗ verfehlt' : '?'}`
        : '';
      lines.push(`- \`${c.id}\` \`${c.command}\` → Exit ${c.code}${flag}${expectNote} · ${new Date(c.ts).toLocaleTimeString('de-DE')}`);
      if (c.stdout?.trim()) lines.push(`  stdout: \`${c.stdout.trim().slice(0, 200)}\``);
      if (c.stderr?.trim()) lines.push(`  stderr: \`${c.stderr.trim().slice(0, 200)}\``);
    }
    lines.push('');
  }
  if (autoResults.length) {
    lines.push('**Automatische Syntaxprüfung** (kein Funktionstest):');
    for (const r of autoResults) {
      const rec = autoCmds.find(c => c.command === r.cmd);
      lines.push(`- \`${rec?.id || '?'}\` \`${r.file}\`: ${r.cmd} → ${r.detail}`);
    }
    lines.push('');
  }
  if (!agentCmds.length && !autoResults.length) {
    lines.push('*Es wurden keine Terminalbefehle ausgeführt.*', '');
  }

  // 3) Status — ausschließlich aus Exit-Codes. Ein Syntax-Check oder ein
  //    beliebiger erfolgreicher Befehl gilt NICHT als bestandener Funktionstest.
  const agentCmdsAll = cmdLog.filter(c => !c.auto);
  const funcTests = agentCmdsAll.filter(c => TEST_CMD_RE.test(c.command));
  // Ein verfehlter Erwartungswert (expectMet === false) gilt als Fehlschlag —
  // auch wenn der Exit-Code 0 war. Exit 0 allein beweist keine Korrektheit.
  const failed = cmdLog.filter(c => c.code !== 0 || c.expectMet === false);
  const passedFunc = funcTests.filter(c => c.code === 0 && c.expectMet !== false);
  const expectChecked = funcTests.filter(c => c.expect !== undefined && c.expectMet === true);
  const passedOther = agentCmdsAll.filter(c => c.code === 0 && c.expectMet !== false && !TEST_CMD_RE.test(c.command));

  let status: string;
  if (failed.length > 0) {
    status = '❌ **Fehlgeschlagen** — mindestens ein Befehl endete mit Fehler oder verfehlte die erwartete Ausgabe (siehe oben)';
  } else if (expectChecked.length > 0) {
    status = `✅ **Funktionstest bestanden** — ${expectChecked.length} Test(s) mit bestätigter erwarteter Ausgabe`;
  } else if (passedFunc.length > 0) {
    // Testbefehl lief mit Exit 0, aber OHNE erwartete Ausgabe — das ist kein
    // Nachweis (eine falsche Funktion kann trotzdem exit 0 liefern).
    status = `⬜ **Kein Funktionstest protokolliert** — ${passedFunc.length} Testbefehl(e) liefen, aber ohne erwartete Ausgabe (kein Nachweis)`;
  } else if (passedOther.length > 0 || autoCmds.some(c => c.code === 0)) {
    status = '⬜ **Kein Funktionstest protokolliert** — nur Syntax-Checks/allgemeine Befehlerfolge, kein Testbeweis';
  } else {
    status = '⬜ **Nicht ausgeführt** — kein Testlauf protokolliert';
  }
  lines.push(`**Status:** ${status}`, '');
  lines.push('*(Dieser Bericht wurde automatisch aus den tatsächlichen Werkzeug-Ergebnissen dieses Auftrags erstellt — keine Modellbehauptung.)*');
  return lines.join('\n');
}
