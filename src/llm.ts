import { AISettings } from './types';
import { loadSettings, saveSettings } from './services/ai';

export type ModelRole = 'chat' | 'code' | 'vision' | 'design';

export interface LocalModel {
  name: string;        // z. B. "qwen2.5-coder:3b"
  path: string;        // absoluter Pfad zur GGUF-Datei
  size: number;        // Bytes
  roles: ModelRole[];  // automatisch erkannte Rollen
}

const CODE_RE = /cod|starcoder|codestral|deepseek|wizardcoder|qwen.*code|codegemma|codeqwen|granite.*code/i;
const VISION_RE = /vl\b|vision|llava|bakllava|moondream|minicpm-v|llama3\.2-vision|qwen.*vl/i;
const DESIGN_RE = /design|flux|stable.?diffusion|sdxl|sd3|playground|ideogram/i;

function rolesFor(name: string): ModelRole[] {
  const roles: ModelRole[] = ['chat'];
  if (CODE_RE.test(name)) roles.push('code');
  if (VISION_RE.test(name)) roles.push('vision');
  if (DESIGN_RE.test(name)) roles.push('design');
  return roles;
}

/** Scannt ~/.ollama/models nach GGUF-Modellen (Manifest → Blob). */
export async function scanLocalModels(): Promise<LocalModel[]> {
  const s = (window as any).studio;
  if (!s) return [];
  try {
    const home = (await s.app.paths()).userData; // z. B. C:\Users\X\AppData\Roaming\ai-developer-studio
    // userData = <home>\AppData\Roaming\<app> → home = alles vor „AppData“
    const parts = home.split(/[\\/]/);
    const appDataIdx = parts.findIndex((p: string, i: number) => p.toLowerCase() === 'appdata' && parts[i + 1]?.toLowerCase() === 'roaming');
    const userHome = appDataIdx > 0 ? parts.slice(0, appDataIdx).join('\\') : home;
    const manifestRoot = `${userHome}/.ollama/models/manifests/registry.ollama.ai/library`;
    const models: LocalModel[] = [];

    const walkManifests = async (dir: string, prefix: string) => {
      let dirs: any[] = [];
      try { dirs = await s.fs.readDir(dir); } catch { return; }
      for (const d of dirs) {
        if (!d.isDir) continue;
        if (prefix && !prefix.endsWith('/')) {
          // eine Ebene: library/<name>/<tag>
          await walkTag(dir, d.path, prefix ? `${prefix}/${d.name}` : d.name);
        } else {
          await walkManifests(d.path, d.name);
        }
      }
    };

    const walkTag = async (_libDir: string, tagDir: string, nameSoFar: string) => {
      let files: any[] = [];
      try { files = await s.fs.readDir(tagDir); } catch { return; }
      for (const f of files) {
        if (f.isDir) continue;
        try {
          const manifest = JSON.parse(await s.fs.readFile(f.path, 2_000_000));
          // finde den Model-Gewichts-Blob (>500MB)
          const layers = manifest.layers || [];
          const big = layers.filter((l: any) => (l.size || 0) > 500_000_000)
            .sort((a: any, b: any) => b.size - a.size)[0];
          if (!big) continue;
          const digest = (big.digest || '').replace('sha256:', '');
          const blobPath = `${userHome}/.ollama/models/blobs/sha256-${digest}`;
          const exists = await s.fs.exists(blobPath, '');
          if (!exists) continue;
          const shortName = nameSoFar.split('/').pop() || nameSoFar;
          const tag = f.name;
          const fullName = `${shortName}:${tag}`;
          models.push({ name: fullName, path: blobPath, size: big.size, roles: rolesFor(fullName) });
        } catch { /* kein valides Manifest */ }
      }
    };

    // Struktur: library/<name>/<tag> — name-Ebene dann tag-Ebene
    // Struktur: library/<name>/<tagDatei> — das Tag ist die Manifest-Datei selbst.
    // Mögliche tiefere Verschachtelung (library/<ns>/<name>/<tag>) wird mit behandelt.
    const tryManifest = async (filePath: string, displayName: string) => {
      try {
        const manifest = JSON.parse(await s.fs.readFile(filePath, 2_000_000));
        const layers = manifest.layers || [];
        const big = layers.filter((l: any) => (l.size || 0) > 500_000_000)
          .sort((a: any, b: any) => b.size - a.size)[0];
        if (!big) return;
        const digest = (big.digest || '').replace('sha256:', '');
        const blobPath = `${userHome}/.ollama/models/blobs/sha256-${digest}`;
        const exists = await s.fs.exists(blobPath, '');
        if (!exists) return;
        models.push({ name: displayName, path: blobPath, size: big.size, roles: rolesFor(displayName) });
      } catch { /* kein valides Manifest */ }
    };

    const libDirs = await s.fs.readDir(manifestRoot).catch(() => [] as any[]);
    for (const nameDir of libDirs) {
      if (!nameDir.isDir) continue;
      const entries = await s.fs.readDir(nameDir.path).catch(() => [] as any[]);
      for (const e of entries) {
        if (e.isDir) {
          // eine Ebene tiefer: library/<name>/<sub>/<tag>
          const sub = await s.fs.readDir(e.path).catch(() => [] as any[]);
          for (const f of sub) {
            if (!f.isDir) await tryManifest(f.path, `${nameDir.name}:${e.name}:${f.name}`);
          }
        } else {
          await tryManifest(e.path, `${nameDir.name}:${e.name}`);
        }
      }
    }
    return models.sort((a, b) => a.size - b.size);
  } catch {
    return [];
  }
}

const PORT = 8080;
const ENDPOINT = `http://localhost:${PORT}/v1`;
let currentModelPath: string | null = null;
let ensureChain: Promise<void> = Promise.resolve();

async function waitHealth(timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Früh abbrechen, wenn der Server-Prozess bereits abgestürzt ist
    try {
      const st = await (window as any).studio.llm.status();
      if (!st.running) {
        const hint = st.lastError ? ` — ${st.lastError.slice(0, 200)}` : '';
        throw new Error(`llama-server ist abgestürzt oder wurde beendet${hint}. Mögliche Ursache: zu wenig RAM oder inkompatibles Modell.`);
      }
    } catch (e: any) {
      if (e.message?.includes('abgestürzt')) throw e;
    }
    try {
      const r = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 700));
  }
  throw new Error('llama-server startet zu langsam oder reagiert nicht.');
}

/** Stellt sicher, dass der richtige Modell-Server läuft. Gibt effektive Settings zurück. */
export async function ensureModel(modelPath: string, mmproj?: string): Promise<void> {
  const run = async () => {
    const st = await (window as any).studio.llm.status();
    if (st.running && st.modelPath === modelPath && (st.mmproj || null) === (mmproj || null)) return;
    await (window as any).studio.llm.start({ modelPath, port: PORT, ctx: 8192, mmproj });
    try {
      await waitHealth();
    } catch (e: any) {
      // Ein automatischer Neustart-Versuch bei Serverabsturz
      const st2 = await (window as any).studio.llm.status().catch(() => null);
      if (st2 && !st2.running) {
        await (window as any).studio.llm.start({ modelPath, port: PORT, ctx: 8192, mmproj });
        await waitHealth(120000);
      } else {
        throw e;
      }
    }
    currentModelPath = modelPath;
  };
  ensureChain = ensureChain.then(run, run);
  return ensureChain;
}

/** Wählt das beste Modell für eine Rolle aus (settings.roleModels hat Vorrang). */
export function pickModelForRole(models: LocalModel[], settings: AISettings, role: ModelRole): LocalModel | null {
  const override = (settings.roleModels as any)?.[role];
  if (override) {
    const m = models.find(m => m.name === override || m.path === override);
    if (m) return m;
  }
  const capable = models.filter(m => m.roles.includes(role));
  if (!capable.length) return models[0] || null;
  // Bevorzuge das größte Modell, das realistisch in den Arbeitsspeicher passt (~3.6 GB);
  // größere Modelle führen auf schwacher Hardware zu OOM. Andernfalls das kleinste fähige.
  const FIT_BUDGET = 3.6e9;
  const fitting = capable.filter(m => m.size <= FIT_BUDGET);
  const pool = fitting.length ? fitting : capable;
  return pool[pool.length - 1]; // models sind aufsteigend nach Größe sortiert
}

/** Gibt OpenAI-kompatible Settings für die Rolle zurück (starte ggf. Modell). */
export async function effectiveSettings(settings: AISettings, role: ModelRole): Promise<AISettings> {
  if (settings.provider !== 'local') return settings;
  // Wiederverwendung: läuft bereits ein OpenAI-kompatibler Server auf :8080
  // (z. B. manuell gestarteter llama-server oder Überrest eines früheren
  // Laufs), ihn nutzen statt einen zweiten zu starten — spart RAM und
  // funktioniert auch bei knappem Speicher.
  try {
    const r = await fetch(`${ENDPOINT}/models`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const id = j?.data?.[0]?.id || settings.customModel || 'local';
      return { ...settings, provider: 'custom', customUrl: ENDPOINT, customModel: id, customKey: '' };
    }
  } catch { /* kein Server → normaler lokaler Pfad */ }
  const models = await scanLocalModels();
  // RAM-Vorabprüfung: nur Modelle wählen, die mit freiem Speicher + Overhead passen
  let memFree: number | null = null;
  try {
    memFree = (await (window as any).studio.sys.info()).memFree;
  } catch { /* sys.info nicht verfügbar → ohne Filter */ }
  let pool = models;
  if (memFree !== null) {
    pool = models.filter(m => m.size * 1.4 <= memFree);
    if (!pool.length) {
      const smallest = models[0];
      throw new Error(
        `Nicht genügend freier Arbeitsspeicher für ein lokales Modell (frei: ${(memFree / 1e9).toFixed(1)} GB, ` +
        `kleinstes Modell „${smallest?.name || '?'}“ benötigt ca. ${((smallest?.size || 0) * 1.4 / 1e9).toFixed(1)} GB). ` +
        `Schließe andere Programme oder starte den PC neu.`
      );
    }
  }
  const m = pickModelForRole(pool, settings, role);
  if (!m) throw new Error('Keine passenden lokalen GGUF-Modelle gefunden. Bitte ein Modell über Ollama pullen oder den Ordner prüfen.');
  if (memFree !== null && memFree < m.size * 1.4) {
    throw new Error(
      `Nicht genügend freier Arbeitsspeicher für „${m.name}“ (benötigt ca. ${(m.size * 1.4 / 1e9).toFixed(1)} GB, frei: ${(memFree / 1e9).toFixed(1)} GB). ` +
      `Schließe andere Programme oder wähle in den Einstellungen ein kleineres Modell für diese Rolle.`
    );
  }
  const mmproj = m.roles.includes('vision') ? settings.mmprojPath : undefined;
  await ensureModel(m.path, mmproj);
  return {
    ...settings,
    provider: 'custom',
    customUrl: ENDPOINT,
    customModel: m.name,
    customKey: '',
  };
}
