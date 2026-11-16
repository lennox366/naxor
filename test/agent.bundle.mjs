var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/llm.ts
var llm_exports = {};
__export(llm_exports, {
  effectiveSettings: () => effectiveSettings,
  ensureModel: () => ensureModel,
  pickModelForRole: () => pickModelForRole,
  scanLocalModels: () => scanLocalModels
});
function rolesFor(name) {
  const roles = ["chat"];
  if (CODE_RE.test(name)) roles.push("code");
  if (VISION_RE.test(name)) roles.push("vision");
  if (DESIGN_RE.test(name)) roles.push("design");
  return roles;
}
async function scanLocalModels() {
  const s = window.studio;
  if (!s) return [];
  try {
    const home = (await s.app.paths()).userData;
    const parts = home.split(/[\\/]/);
    const appDataIdx = parts.findIndex((p, i) => p.toLowerCase() === "appdata" && parts[i + 1]?.toLowerCase() === "roaming");
    const userHome = appDataIdx > 0 ? parts.slice(0, appDataIdx).join("\\") : home;
    const manifestRoot = `${userHome}/.ollama/models/manifests/registry.ollama.ai/library`;
    const models = [];
    const walkManifests = async (dir, prefix) => {
      let dirs = [];
      try {
        dirs = await s.fs.readDir(dir);
      } catch {
        return;
      }
      for (const d of dirs) {
        if (!d.isDir) continue;
        if (prefix && !prefix.endsWith("/")) {
          await walkTag(dir, d.path, prefix ? `${prefix}/${d.name}` : d.name);
        } else {
          await walkManifests(d.path, d.name);
        }
      }
    };
    const walkTag = async (_libDir, tagDir, nameSoFar) => {
      let files = [];
      try {
        files = await s.fs.readDir(tagDir);
      } catch {
        return;
      }
      for (const f of files) {
        if (f.isDir) continue;
        try {
          const manifest = JSON.parse(await s.fs.readFile(f.path, 2e6));
          const layers = manifest.layers || [];
          const big = layers.filter((l) => (l.size || 0) > 5e8).sort((a, b) => b.size - a.size)[0];
          if (!big) continue;
          const digest = (big.digest || "").replace("sha256:", "");
          const blobPath = `${userHome}/.ollama/models/blobs/sha256-${digest}`;
          const exists = await s.fs.exists(blobPath, "");
          if (!exists) continue;
          const shortName = nameSoFar.split("/").pop() || nameSoFar;
          const tag = f.name;
          const fullName = `${shortName}:${tag}`;
          models.push({ name: fullName, path: blobPath, size: big.size, roles: rolesFor(fullName) });
        } catch {
        }
      }
    };
    const tryManifest = async (filePath, displayName) => {
      try {
        const manifest = JSON.parse(await s.fs.readFile(filePath, 2e6));
        const layers = manifest.layers || [];
        const big = layers.filter((l) => (l.size || 0) > 5e8).sort((a, b) => b.size - a.size)[0];
        if (!big) return;
        const digest = (big.digest || "").replace("sha256:", "");
        const blobPath = `${userHome}/.ollama/models/blobs/sha256-${digest}`;
        const exists = await s.fs.exists(blobPath, "");
        if (!exists) return;
        models.push({ name: displayName, path: blobPath, size: big.size, roles: rolesFor(displayName) });
      } catch {
      }
    };
    const libDirs = await s.fs.readDir(manifestRoot).catch(() => []);
    for (const nameDir of libDirs) {
      if (!nameDir.isDir) continue;
      const entries = await s.fs.readDir(nameDir.path).catch(() => []);
      for (const e of entries) {
        if (e.isDir) {
          const sub = await s.fs.readDir(e.path).catch(() => []);
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
async function waitHealth(timeoutMs = 18e4) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const st = await window.studio.llm.status();
      if (!st.running) {
        const hint = st.lastError ? ` \u2014 ${st.lastError.slice(0, 200)}` : "";
        throw new Error(`llama-server ist abgest\xFCrzt oder wurde beendet${hint}. M\xF6gliche Ursache: zu wenig RAM oder inkompatibles Modell.`);
      }
    } catch (e) {
      if (e.message?.includes("abgest\xFCrzt")) throw e;
    }
    try {
      const r = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(2e3) });
      if (r.ok) return;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("llama-server startet zu langsam oder reagiert nicht.");
}
async function ensureModel(modelPath, mmproj) {
  const run2 = async () => {
    const st = await window.studio.llm.status();
    if (st.running && st.modelPath === modelPath && (st.mmproj || null) === (mmproj || null)) return;
    await window.studio.llm.start({ modelPath, port: PORT, ctx: 8192, mmproj });
    try {
      await waitHealth();
    } catch (e) {
      const st2 = await window.studio.llm.status().catch(() => null);
      if (st2 && !st2.running) {
        await window.studio.llm.start({ modelPath, port: PORT, ctx: 8192, mmproj });
        await waitHealth(12e4);
      } else {
        throw e;
      }
    }
    currentModelPath = modelPath;
  };
  ensureChain = ensureChain.then(run2, run2);
  return ensureChain;
}
function pickModelForRole(models, settings, role) {
  const override = settings.roleModels?.[role];
  if (override) {
    const m = models.find((m2) => m2.name === override || m2.path === override);
    if (m) return m;
  }
  const capable = models.filter((m) => m.roles.includes(role));
  if (!capable.length) return models[0] || null;
  const FIT_BUDGET = 36e8;
  const fitting = capable.filter((m) => m.size <= FIT_BUDGET);
  const pool = fitting.length ? fitting : capable;
  return pool[pool.length - 1];
}
async function effectiveSettings(settings, role) {
  if (settings.provider !== "local") return settings;
  try {
    const r = await fetch(`${ENDPOINT}/models`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const id = j?.data?.[0]?.id || settings.customModel || "local";
      return { ...settings, provider: "custom", customUrl: ENDPOINT, customModel: id, customKey: "" };
    }
  } catch {
  }
  const models = await scanLocalModels();
  let memFree = null;
  try {
    memFree = (await window.studio.sys.info()).memFree;
  } catch {
  }
  let pool = models;
  if (memFree !== null) {
    pool = models.filter((m2) => m2.size * 1.4 <= memFree);
    if (!pool.length) {
      const smallest = models[0];
      throw new Error(
        `Nicht gen\xFCgend freier Arbeitsspeicher f\xFCr ein lokales Modell (frei: ${(memFree / 1e9).toFixed(1)} GB, kleinstes Modell \u201E${smallest?.name || "?"}\u201C ben\xF6tigt ca. ${((smallest?.size || 0) * 1.4 / 1e9).toFixed(1)} GB). Schlie\xDFe andere Programme oder starte den PC neu.`
      );
    }
  }
  const m = pickModelForRole(pool, settings, role);
  if (!m) throw new Error("Keine passenden lokalen GGUF-Modelle gefunden. Bitte ein Modell \xFCber Ollama pullen oder den Ordner pr\xFCfen.");
  if (memFree !== null && memFree < m.size * 1.4) {
    throw new Error(
      `Nicht gen\xFCgend freier Arbeitsspeicher f\xFCr \u201E${m.name}\u201C (ben\xF6tigt ca. ${(m.size * 1.4 / 1e9).toFixed(1)} GB, frei: ${(memFree / 1e9).toFixed(1)} GB). Schlie\xDFe andere Programme oder w\xE4hle in den Einstellungen ein kleineres Modell f\xFCr diese Rolle.`
    );
  }
  const mmproj = m.roles.includes("vision") ? settings.mmprojPath : void 0;
  await ensureModel(m.path, mmproj);
  return {
    ...settings,
    provider: "custom",
    customUrl: ENDPOINT,
    customModel: m.name,
    customKey: ""
  };
}
var CODE_RE, VISION_RE, DESIGN_RE, PORT, ENDPOINT, currentModelPath, ensureChain;
var init_llm = __esm({
  "src/llm.ts"() {
    "use strict";
    CODE_RE = /cod|starcoder|codestral|deepseek|wizardcoder|qwen.*code|codegemma|codeqwen|granite.*code/i;
    VISION_RE = /vl\b|vision|llava|bakllava|moondream|minicpm-v|llama3\.2-vision|qwen.*vl/i;
    DESIGN_RE = /design|flux|stable.?diffusion|sdxl|sd3|playground|ideogram/i;
    PORT = 8080;
    ENDPOINT = `http://localhost:${PORT}/v1`;
    currentModelPath = null;
    ensureChain = Promise.resolve();
  }
});

// test/db-stub.ts
var rows = [];
function query(sql, params = []) {
  if (/FROM knowledge/i.test(sql)) {
    const scope = params[0];
    const hasKind = /kind=\?/.test(sql);
    const kind = hasKind ? params[1] : null;
    const qIdx = hasKind ? 2 : 1;
    const q = (params[qIdx] || "").toLowerCase().replace(/%/g, "");
    const wantsGlobal = /scope='global'/.test(sql);
    return rows.filter((r) => (r.scope === scope || wantsGlobal && r.scope === "global") && (!kind || r.kind === kind)).filter((r) => !q || (r.title + " " + r.content).toLowerCase().includes(q)).sort((a, b) => (b.verified || 0) - (a.verified || 0)).slice(0, 10);
  }
  return [];
}
function run(sql, params = []) {
  if (/INSERT INTO knowledge/i.test(sql)) {
    rows.push({ id: params[0], scope: params[1], kind: params[2], title: params[3], content: params[4], verified: params[5] || 0, created_at: params[6] });
  }
}
function _rows() {
  return rows;
}

// src/services/ai.ts
async function ollamaAgentStep(baseUrl, model, messages, tools, onToken, signal) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, stream: true }),
    signal
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(friendlyOllamaError(res.status, txt));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "";
  const toolCalls = [];
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const t = j.message?.content || "";
        if (t) {
          content += t;
          onToken(t);
        }
        const tc = j.message?.tool_calls;
        if (tc) {
          for (const c of tc) {
            const idx = c.function?.index ?? toolCalls.length;
            if (!toolCalls[idx]) toolCalls[idx] = { function: { name: "", arguments: {} } };
            if (c.function?.name) toolCalls[idx].function.name = c.function.name;
            const args = c.function?.arguments;
            if (typeof args === "string") {
              try {
                toolCalls[idx].function.arguments = JSON.parse(args);
              } catch {
              }
            } else if (args) {
              toolCalls[idx].function.arguments = { ...toolCalls[idx].function.arguments, ...args };
            }
          }
        }
      } catch {
      }
    }
  }
  const valid = toolCalls.filter(Boolean);
  return { role: "assistant", content, ...valid.length ? { tool_calls: valid } : {} };
}
async function openAIToolStep(baseUrl, apiKey, model, messages, tools, onToken, signal) {
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const oaiMessages = messages.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    const out = { role: m.role, content: m.content || "" };
    if (m.tool_calls) {
      out.tool_calls = m.tool_calls.map((c, i) => ({
        id: c.id || `call_${i}`,
        type: "function",
        function: { name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments || {}) }
      }));
    }
    return out;
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiKey ? { Authorization: `Bearer ${apiKey}` } : {} },
    body: JSON.stringify({ model, messages: oaiMessages, tools, stream: true, max_tokens: 1500 }),
    signal
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(friendlyOllamaError(res.status, txt));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "";
  const toolCalls = [];
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const p = t.slice(5).trim();
      if (p === "[DONE]") continue;
      try {
        const j = JSON.parse(p);
        const d = j.choices?.[0]?.delta;
        if (d?.content) {
          content += d.content;
          onToken(d.content);
        }
        if (d?.tool_calls) {
          for (const c of d.tool_calls) {
            const idx = c.index ?? toolCalls.length;
            if (!toolCalls[idx]) toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            if (c.id) toolCalls[idx].id = c.id;
            if (c.function?.name) toolCalls[idx].function.name += c.function.name;
            if (c.function?.arguments) toolCalls[idx].function.arguments += c.function.arguments;
          }
        }
      } catch {
      }
    }
  }
  const valid = toolCalls.filter(Boolean).map((c) => ({
    id: c.id || `call_${Math.random().toString(36).slice(2, 8)}`,
    function: {
      name: c.function.name,
      arguments: (() => {
        try {
          return JSON.parse(c.function.arguments || "{}");
        } catch {
          return {};
        }
      })()
    }
  }));
  return { role: "assistant", content, ...valid.length ? { tool_calls: valid } : {} };
}
function friendlyOllamaError(status, body) {
  const lower = (body + "").toLowerCase();
  if (status === 404 && (lower.includes("not found") || lower.includes("does not exist"))) {
    return "Das ausgew\xE4hlte Modell ist nicht installiert. \xD6ffne die Einstellungen \u2192 KI-Provider \u2192 \u201EModelle verwalten\u201C, um es zu laden oder ein anderes Modell zu w\xE4hlen.";
  }
  if (status === 404) return "Endpunkt nicht gefunden \u2014 ist Ollama gestartet? (ollama serve)";
  if (lower.includes("out-of-memory") || lower.includes("unable to allocate") || lower.includes("cuda") && lower.includes("memory")) {
    return "Nicht gen\xFCgend GPU-/Arbeitsspeicher f\xFCr dieses Modell. W\xE4hle ein kleineres Modell in den Einstellungen (z. B. 3B-Quantisierung) oder schlie\xDFe andere GPU-Anwendungen.";
  }
  if (lower.includes("llama-server") || lower.includes("wsarecv") || lower.includes("remotehost") || lower.includes("closed")) {
    return "Das KI-Modell konnte nicht geladen werden \u2014 der lokale Server ist abgest\xFCrzt (meist zu wenig freier GPU-/RAM-Speicher). Bitte ein kleineres Modell w\xE4hlen (z. B. qwen2.5vl:3b oder ein 3B-Modell) oder andere GPU-Programme schlie\xDFen.";
  }
  if (lower.includes("connection") || status === 0) return "Ollama ist nicht erreichbar. Bitte sicherstellen, dass Ollama l\xE4uft (http://localhost:11434).";
  if (status === 401 || status === 403) return "API-Zugang verweigert \u2014 bitte API-Key in den Einstellungen pr\xFCfen.";
  if (status === 400 && lower.includes("model")) return "Modellfehler \u2014 bitte in den Einstellungen ein installiertes Modell w\xE4hlen.";
  return `KI-Fehler ${status}: ${body.slice(0, 300) || "unbekannt"}`;
}

// src/agent.ts
var TEST_CMD_RE = /(pytest|unittest|npm\s+(run\s+)?test|node\s+-e\b|node\s+[\w./\\-]+\.(js|mjs|cjs)|python3?\s+-c\b|python\s+[\w./\\-]+\.py|python3?\s+-m\s+(?!py_compile\b)|jest|vitest|go\s+test|cargo\s+test|mvn\s+test|dotnet\s+test|phpunit|rspec|ctest|make\s+test)/i;
var agentRuns = /* @__PURE__ */ new Set();
var DANGEROUS = /(\brm\s|\bdel\b|\brmdir\b|\bformat\b|\bshutdown\b|\brestart(-computer)?\b|mkfs|\bdd\s+if=|>\s*\/dev|remove-item|clear-disk|reg\s+(delete|add)|net\s+(user|localgroup)|set-executionpolicy|iex\b|invoke-expression|curl[^|]*\|\s*(iex|sh|bash)|wget[^|]*\|\s*(iex|sh|bash)|git\s+(commit|push|reset|rebase|merge|clean|checkout)\b)/i;
var studio = () => window.studio;
function toRel(root, p) {
  const norm = p.replace(/\\/g, "/");
  const rootN = root.replace(/\\/g, "/").replace(/\/$/, "");
  return norm.startsWith(rootN + "/") ? norm.slice(rootN.length + 1) : norm;
}
function abs(root, rel) {
  const raw = String(rel || "").trim();
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("/")) {
    const r = raw.replace(/\\/g, "/");
    const rootN = root.replace(/\\/g, "/").replace(/\/$/, "");
    if (!r.startsWith(rootN + "/")) throw new Error("Pfad liegt au\xDFerhalb des Projekts");
    rel = r.slice(rootN.length + 1);
  }
  const segments = rel.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (segments.some((s) => /[<>:"|?*]/.test(s) || s === "..")) {
    throw new Error(`Ung\xFCltiger Pfad: ${rel} \u2014 verwende nur einfache relative Pfade innerhalb des Projekts`);
  }
  return root.replace(/[\\/]+$/, "") + "/" + segments.join("/");
}
async function backupFile(root, rel) {
  try {
    const content = await studio().fs.readFile(abs(root, rel));
    const paths = await studio().app.paths();
    const hash = root.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
    const bakRel = `backups/${hash}/${rel.replace(/[\\/]/g, "__")}`;
    const bakAbs = paths.filesDir + "/" + bakRel;
    await studio().fs.writeFile(bakAbs, content);
    return bakAbs;
  } catch {
    return null;
  }
}
function getBackupPath(root, rel) {
  const hash = root.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
  return `backups/${hash}/${rel.replace(/[\\/]/g, "__")}`;
}
async function readBackup(root, rel) {
  try {
    const paths = await studio().app.paths();
    return await studio().fs.readFile(paths.filesDir + "/" + getBackupPath(root, rel));
  } catch {
    return null;
  }
}
function quickHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(16);
}
var SANDBOX_SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", ".next", "bin", "obj", "__pycache__", ".venv", "venv", "target", "release", ".idea", ".vs", ".aistudio"]);
var SANDBOX_MAX_FILE = 2e6;
async function createSandboxCopy(root) {
  const s = studio();
  const paths = await s.app.paths();
  const hash = root.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
  const sandbox = `${paths.filesDir}/sandbox/${hash}-${Date.now().toString(36)}`;
  const tree = await s.fs.listTree(root, { maxDepth: 10 });
  const manifest = {};
  let copied = 0;
  for (const n of tree) {
    if (n.isDir) continue;
    if (n.name.startsWith(".")) continue;
    const rel = toRel(root, n.path).replace(/\\/g, "/");
    const top = rel.split("/")[0];
    if (SANDBOX_SKIP_DIRS.has(top) || SANDBOX_SKIP_DIRS.has(n.name)) continue;
    try {
      const st = await s.fs.stat(root, rel);
      if (st.size > SANDBOX_MAX_FILE) continue;
      const content = await s.fs.readFile(n.path, SANDBOX_MAX_FILE);
      await s.fs.writeFile(`${sandbox}/${rel}`, content);
      manifest[rel] = quickHash(content);
      copied++;
    } catch {
    }
  }
  if (copied === 0) return null;
  try {
    await s.fs.writeFile(`${sandbox}.manifest.json`, JSON.stringify(manifest));
  } catch {
  }
  return sandbox;
}
async function applySandboxChanges(projectRoot, sandboxRoot, changedFiles) {
  const s = studio();
  const applied = [], failed = [], skipped = [], conflicts = [];
  let manifest = {};
  try {
    manifest = JSON.parse(await s.fs.readFile(`${sandboxRoot}.manifest.json`, 5e6));
  } catch {
  }
  for (const rel of changedFiles) {
    try {
      const inSand = await s.fs.exists(sandboxRoot, rel);
      const inOrig = await s.fs.exists(projectRoot, rel);
      const hadInOrig = rel in manifest;
      if (inOrig) {
        const origContent = await s.fs.readFile(abs(projectRoot, rel), SANDBOX_MAX_FILE);
        const origHash = quickHash(origContent);
        if (hadInOrig) {
          if (origHash !== manifest[rel]) {
            conflicts.push(rel);
            continue;
          }
        } else if (inSand) {
          conflicts.push(rel);
          continue;
        }
      } else if (hadInOrig) {
        conflicts.push(rel);
        continue;
      }
      if (inSand === inOrig) {
        if (inSand) {
          const a = await s.fs.readFile(`${sandboxRoot}/${rel}`, SANDBOX_MAX_FILE);
          const b = await s.fs.readFile(abs(projectRoot, rel), SANDBOX_MAX_FILE);
          if (a === b) {
            skipped.push(rel);
            continue;
          }
        } else {
          skipped.push(rel);
          continue;
        }
      }
      if (inOrig) await backupFile(projectRoot, rel);
      if (inSand) {
        const content = await s.fs.readFile(`${sandboxRoot}/${rel}`, SANDBOX_MAX_FILE);
        await s.fs.writeFile(abs(projectRoot, rel), content);
      } else {
        await s.fs.deletePath(projectRoot, rel);
      }
      applied.push(rel);
    } catch {
      failed.push(rel);
    }
  }
  return { applied, failed, skipped, conflicts };
}
async function discardSandbox(sandboxRoot) {
  try {
    await studio().fs.deletePath(sandboxRoot, ".");
  } catch {
  }
}
var TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "Listet Dateien und Unterordner eines Verzeichnisses im Projekt.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Relativer Pfad, Standard: Projektwurzel" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Liest den Inhalt einer Textdatei. Gro\xDFe Dateien werden gek\xFCrzt.",
      parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["path"] }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Erstellt oder \xFCberschreibt eine Datei mit neuem Inhalt. Erstellt fehlende Ordner. Vor dem \xDCberschreiben wird automatisch ein Backup angelegt.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_path",
      description: "L\xF6scht eine Datei oder einen Ordner (rekursiv).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    }
  },
  {
    type: "function",
    function: {
      name: "mkdir",
      description: "Erstellt ein Verzeichnis (inkl. fehlender Elternordner).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_path",
      description: "Benennt eine Datei/einen Ordner um oder verschiebt sie.",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "F\xFChrt einen Terminalbefehl im Projektordner aus (PowerShell unter Windows). Kritische Befehle erfordern Nutzerbest\xE4tigung.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
    }
  },
  {
    type: "function",
    function: {
      name: "run_test",
      description: 'F\xFChrt einen Testbefehl aus und pr\xFCft die TATS\xC4CHLICHE Ausgabe gegen eine Erwartung. IMMERVorrang vor run_command f\xFCr Funktionstests: exit 0 allein beweist nichts \u2014 die Ausgabe muss den erwarteten Wert enthalten. expect muss die exakte erwartete Ausgabe sein (z. B. \u201Esubtrahiere(5,3)= 2"), niemals nur eine beliebige Zahl.',
      parameters: { type: "object", properties: {
        command: { type: "string", description: "Auszuf\xFChrender Befehl" },
        expect: { type: "string", description: 'Text, der in der Standardausgabe enthalten sein muss (z. B. "42")' },
        expect_exit: { type: "number", description: "Erwarteter Exit-Code, Standard 0" }
      }, required: ["command", "expect"] }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Durchsucht Dateiinhalte nach einem Text (grep-\xE4hnlich).",
      parameters: { type: "object", properties: { query: { type: "string" }, path: { type: "string", description: "Optional: Unterordner" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Ersetzt eine Textpassage in einer Datei (alte Passage \u2192 neue Passage). Sicherer als write_file f\xFCr kleine \xC4nderungen. Whitespace-Unterschiede (Einr\xFCckung) werden automatisch toleriert.",
      parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] }
    }
  },
  {
    type: "function",
    function: {
      name: "replace_lines",
      description: "Ersetzt einen exakten Zeilenbereich (start_line bis end_line, 1-basiert, inklusiv) durch new_text \u2014 KEIN altes Text-Snippet n\xF6tig. Nach read_file (Zeilennummern sichtbar) die betroffenen Zeilennummern angeben. Backup + R\xFCcklesen + JSON-Check inklusive. Bevorzugt f\xFCr den 3B-Modell-Fall, wo exakt kopierter old_text scheitert.",
      parameters: { type: "object", properties: {
        path: { type: "string" },
        start_line: { type: "number", description: "Erste zu ersetzende Zeile (1-basiert)" },
        end_line: { type: "number", description: "Letzte zu ersetzende Zeile (standard = start_line)" },
        new_text: { type: "string", description: "Ersatztext f\xFCr diesen Bereich" }
      }, required: ["path", "start_line", "new_text"] }
    }
  },
  {
    type: "function",
    function: {
      name: "set_json_value",
      description: "Setzt einen Wert in einer JSON-Datei anhand des Schl\xFCsselnamens (z. B. \u201EfeedbackChannelId\u201C oder verschachtelt \u201Econfig.channelId\u201C). KEIN altes Text-Snippet n\xF6tig \u2014 ideal f\xFCr Konfigurationen. Wert bleibt String, sofern er nicht eindeutig number/boolean ist. Vor dem Schreiben wird ein Backup angelegt und danach zur\xFCckgelesen + validiert.",
      parameters: { type: "object", properties: {
        path: { type: "string" },
        key: { type: "string", description: 'Schl\xFCsselname oder Punkt-Pfad, z. B. "feedbackChannelId"' },
        value: { type: "string", description: "Neuer Wert als Text (Zahlen >15 Stellen und IDs bleiben Strings)" },
        create_missing: { type: "boolean", description: "true = fehlende Schl\xFCssel anlegen (Standard), false = nur vorhandene \xE4ndern" }
      }, required: ["path", "key", "value"] }
    }
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Speichert Wissen dauerhaft in der gemeinsamen Wissensdatenbank \u2014 f\xFCr ALLE KI-Bereiche nutzbar. scope=\u201Eglobal\u201C f\xFCr projekt\xFCbergreifendes Wissen (Sprachen, Frameworks, allgemeine Fehler), scope=\u201Eprojekt\u201C (Standard) f\xFCr projektspezifische Fakten. verified=1 NUR wenn die Information auf echten, im Protokoll nachvollziehbaren Werkzeug-Ergebnissen beruht (z. B. bestandener run_test, best\xE4tigter Bugfix) \u2014 niemals f\xFCr blo\xDFe Vermutungen oder Modellbehauptungen.",
      parameters: { type: "object", properties: {
        title: { type: "string" },
        content: { type: "string" },
        kind: { type: "string", description: "z. B. projekt, fehler, entscheidung, bibliothek, testergebnis, architektur, regel" },
        scope: { type: "string", description: "\u201Eglobal\u201C oder \u201Eprojekt\u201C (Standard)" },
        verified: { type: "boolean", description: "true nur bei durch echte Tool-Ergebnisse best\xE4tigtem Wissen" }
      }, required: ["title", "content"] }
    }
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Durchsucht die gemeinsame Wissensdatenbank nach Stichworten \u2014 nutzt sowohl projektspezifisches als auch globales, von anderen KI-Bereichen geteiltes Wissen (f\xFCr Projektkontext aus fr\xFCheren Sitzungen).",
      parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Sucht kostenlos im Internet (DuckDuckGo) nach Dokumentation, Fehlerl\xF6sungen oder Bibliotheken. Optional.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "L\xE4dt eine Webseiten-URL und gibt den Textinhalt zur\xFCck (f\xFCr Dokumentation/Recherche).",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
    }
  },
  {
    type: "function",
    function: {
      name: "project_overview",
      description: "Analysiert das gesamte Projekt in EINEM Aufruf: Verzeichnisstruktur, erkannte Programmiersprachen (Datei-Anzahlen), Build-/Dependency-Dateien (package.json, requirements.txt, pom.xml, Cargo.toml, go.mod, composer.json, pubspec.yaml, *.csproj, CMakeLists.txt, Dockerfile u. a.) und Git-Vorhandensein. IMMER zuerst bei Projektstart oder gr\xF6\xDFerem Auftrag nutzen \u2014 spart viele list_dir-Aufrufe.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Liest den Git-Zustand des Projekts (NUR LESEN, ver\xE4ndert nichts): Branch, ge\xE4nderte/unversionierte Dateien (git status), Diff-Statistik und die letzten 5 Commits. F\xFCr Projektanalyse und \xC4nderungsverfolgung. Mutierende Git-Befehle (commit, push, checkout, reset \u2026) laufen weiterhin \xFCber run_command mit Nutzer-Best\xE4tigung.",
      parameters: { type: "object", properties: {} }
    }
  }
];
function isProtectedPath(rel) {
  const base = String(rel || "").split(/[\\/]/).pop() || "";
  if (/^\.env(\..+)?$/i.test(base)) {
    return !/\.(example|sample|template|dist)$/i.test(base);
  }
  return /\.(pem|key|p12|pfx)$/i.test(base) || /id_rsa|credentials/i.test(base);
}
async function execTool(name, args, root, onConfirm, cmdLog, auftragId, onDiff) {
  const s = studio();
  const fileArg = args.path || args.from || args.to;
  if (["read_file", "write_file", "edit_file", "delete_path", "rename_path", "search_files"].includes(name) && fileArg && isProtectedPath(String(fileArg))) {
    return "FEHLER: Diese Datei enth\xE4lt vermutlich Zugangsdaten und ist f\xFCr den Agenten gesperrt (.env, Keys, Credentials). Bitte manuell pr\xFCfen.";
  }
  switch (name) {
    case "list_dir": {
      const rel = args.path || ".";
      const absPath = abs(root, rel);
      const entries = await s.fs.readDir(absPath);
      const skip = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", ".next", "bin", "obj", "__pycache__"]);
      return entries.filter((e) => !skip.has(e.name)).map((e) => `${e.isDir ? "DIR " : "FILE"} ${toRel(root, e.path)}`).join("\n") || "(leer)";
    }
    case "read_file": {
      const p = abs(root, args.path);
      let content;
      try {
        content = await s.fs.readFile(p, 4e5);
      } catch (e) {
        return `FEHLER: Datei nicht gefunden: ${args.path} (${String(e?.message || e).slice(0, 120)}). Verwende den EXAKTEN Pfad aus list_dir oder search_files \u2014 erfinde keine Unterordner wie \u201Esrc/\u201C. Liegt die Datei im Projekt-Root, ohne Verzeichnis angeben.`;
      }
      const lines = content.split("\n");
      const off = args.offset || 0, lim = args.limit || 400;
      const slice = lines.slice(off, off + lim);
      const numbered = slice.map((l, i) => `${String(off + i + 1).padStart(4)}| ${l}`).join("\n");
      return `Datei: ${toRel(root, p)} (${lines.length} Zeilen)
${numbered}${off + lim < lines.length ? `
\u2026 [${lines.length - off - lim} weitere Zeilen, offset=${off + lim}]` : ""}
(Hinweis: Zeilennummern nur zur Orientierung \u2014 old_text OHNE Nummern angeben; f\xFCr gezielte Zeilen replace_lines nutzen.)`;
    }
    case "write_file": {
      const rel = args.path;
      const p = abs(root, rel);
      const existed = await s.fs.exists(root, rel);
      const oldText = existed ? await s.fs.readFile(p, 4e5).catch(() => null) : null;
      if (existed) await backupFile(root, rel);
      const dir = p.replace(/[\\/][^\\/]+$/, "");
      await s.fs.mkdir(dir, "");
      await s.fs.writeFile(p, args.content ?? "");
      let verify = "";
      try {
        const reread = await s.fs.readFile(p, 2e6);
        verify = reread === String(args.content ?? "") ? ` \u2014 R\xFCcklesen verifiziert (${reread.length} Zeichen)` : ` \u2014 WARNUNG: R\xFCcklesen weicht vom geschriebenen Inhalt ab!`;
        if (/\.jsonc?$/i.test(String(rel)) && verify.includes("verifiziert")) {
          try {
            JSON.parse(reread);
            verify += " \u2014 JSON-Syntax: g\xFCltig";
          } catch (je) {
            verify += ` \u2014 FEHLER: JSON-Syntax ung\xFCltig: ${je.message}`;
          }
        }
        if (verify.includes("FEHLER")) return `FEHLER: ${rel} geschrieben, aber ${verify.trim()} \u2014 bitte korrigiere den Inhalt.`;
        if (oldText != null) onDiff?.({ path: rel, oldText: oldText.slice(0, 8e4), newText: String(args.content ?? "").slice(0, 8e4) });
      } catch {
        verify = " \u2014 R\xFCck-Verifikation nicht m\xF6glich";
      }
      return `OK: ${rel} ${existed ? "\xFCberschrieben (Backup angelegt)" : "erstellt"} \u2014 ${String(args.content ?? "").split("\n").length} Zeilen${verify}`;
    }
    case "delete_path": {
      const rel = args.path;
      await backupFile(root, rel);
      await s.fs.deletePath(root, rel);
      return `OK: ${rel} gel\xF6scht (Backup angelegt)`;
    }
    case "edit_file": {
      const p = abs(root, args.path);
      const content = await s.fs.readFile(p, 2e6);
      const oldT = String(args.old_text ?? "");
      const newT = String(args.new_text ?? "");
      if (!oldT) return "FEHLER: old_text darf nicht leer sein.";
      let idx = content.indexOf(oldT);
      let matchLen = oldT.length;
      let fuzzy = false;
      if (idx < 0) {
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const parts = oldT.trim().split(/\s+/).filter(Boolean).map(esc);
        if (parts.length) {
          const re = new RegExp(parts.join("\\s+"), "g");
          const matches = [...content.matchAll(re)];
          if (matches.length === 1) {
            idx = matches[0].index;
            matchLen = matches[0][0].length;
            fuzzy = true;
          }
        }
      }
      if (idx < 0) {
        const token = oldT.trim().split(/\s+/).find((w) => w.length >= 4 && /[a-zA-Z]/.test(w));
        let lineHint = "";
        if (token) {
          const tl = token.toLowerCase();
          const hits = content.split("\n").map((l, i) => l.toLowerCase().includes(tl) ? i + 1 : 0).filter(Boolean).slice(0, 5);
          if (hits.length) lineHint = `
M\xF6gliche Zeilen mit \u201E${token}\u201C: ${hits.join(", ")} \u2014 nutze replace_lines(start_line, end_line, new_text) mit diesen Zeilennummern.`;
        }
        return `FEHLER: old_text nicht in Datei gefunden. Aktueller Dateiinhalt (erste 2000 Zeichen):
${content.slice(0, 2e3)}${lineHint}
\u2014\u2014 W\xE4hle old_text EXAKT aus diesem Inhalt (auf Einr\xFCckung und Zeilenumbr\xFCche achten) oder nutze replace_lines mit den Zeilennummern aus read_file.`;
      }
      if (!fuzzy && content.indexOf(oldT, idx + 1) >= 0) return "FEHLER: old_text kommt mehrfach vor \u2014 pr\xE4zisiere die Passage.";
      await backupFile(root, toRel(root, p));
      const expected = content.slice(0, idx) + newT + content.slice(idx + matchLen);
      await s.fs.writeFile(p, expected);
      let verify = "";
      try {
        const reread = await s.fs.readFile(p, 2e6);
        verify = reread === expected ? " \u2014 R\xFCcklesen verifiziert" : " \u2014 WARNUNG: gespeicherter Inhalt weicht ab!";
        if (/\.jsonc?$/i.test(String(args.path)) && verify.includes("verifiziert")) {
          try {
            JSON.parse(reread);
            verify += " \u2014 JSON-Syntax: g\xFCltig";
          } catch (je) {
            verify += ` \u2014 FEHLER: JSON-Syntax ung\xFCltig: ${je.message}`;
          }
        }
      } catch {
        verify = " \u2014 R\xFCck-Verifikation nicht m\xF6glich";
      }
      if (verify.includes("FEHLER")) return `FEHLER: ${args.path} geschrieben, aber ${verify.trim()} \u2014 bitte korrigiere den Inhalt.`;
      onDiff?.({ path: toRel(root, p), oldText: content.slice(0, 8e4), newText: expected.slice(0, 8e4) });
      return `OK: ${toRel(root, p)} bearbeitet${fuzzy ? " (whitespace-toleranter Treffer)" : ""} (Backup angelegt)${verify}`;
    }
    case "replace_lines": {
      const p = abs(root, args.path);
      const content = await s.fs.readFile(p, 2e6);
      const flines = content.split("\n");
      const start = Math.floor(Number(args.start_line));
      const end = Math.floor(Number(args.end_line ?? args.start_line));
      if (!Number.isFinite(start) || start < 1 || start > flines.length) return `FEHLER: start_line ${args.start_line} ung\xFCltig \u2014 die Datei hat ${flines.length} Zeilen.`;
      if (!Number.isFinite(end) || end < start || end > flines.length) return `FEHLER: end_line ${args.end_line} ung\xFCltig \u2014 g\xFCltig w\xE4re ${start} bis ${flines.length}.`;
      const newLines = String(args.new_text ?? "").split("\n");
      const expected = [...flines.slice(0, start - 1), ...newLines, ...flines.slice(end)].join("\n");
      await backupFile(root, toRel(root, p));
      await s.fs.writeFile(p, expected);
      let verify = "";
      try {
        const reread = await s.fs.readFile(p, 2e6);
        verify = reread === expected ? " \u2014 R\xFCcklesen verifiziert" : " \u2014 WARNUNG: gespeicherter Inhalt weicht ab!";
        if (/\.jsonc?$/i.test(String(args.path)) && verify.includes("verifiziert")) {
          try {
            JSON.parse(reread);
            verify += " \u2014 JSON-Syntax: g\xFCltig";
          } catch (je) {
            verify += ` \u2014 FEHLER: JSON-Syntax ung\xFCltig: ${je.message}`;
          }
        }
      } catch {
        verify = " \u2014 R\xFCck-Verifikation nicht m\xF6glich";
      }
      if (verify.includes("FEHLER")) return `FEHLER: ${args.path} geschrieben, aber ${verify.trim()} \u2014 bitte korrigiere den Inhalt.`;
      onDiff?.({ path: toRel(root, p), oldText: flines.slice(start - 1, end).join("\n").slice(0, 8e4), newText: newLines.join("\n").slice(0, 8e4) });
      return `OK: ${toRel(root, p)} \u2014 Zeilen ${start}\u2013${end} ersetzt durch ${newLines.length} Zeile(n)${verify}`;
    }
    case "set_json_value": {
      const rel = args.path;
      const p = abs(root, rel);
      let raw;
      try {
        raw = await s.fs.readFile(p, 2e6);
      } catch (e) {
        return `FEHLER: JSON-Datei nicht gefunden: ${rel} (${String(e?.message || e).slice(0, 120)}). Verwende den EXAKTEN Pfad aus search_files (z. B. \u201ETicket-System.json\u201C) \u2014 ohne erfundene Unterordner.`;
      }
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        return `FEHLER: ${rel} ist kein g\xFCltiges JSON (${e.message}). Datei-Anfang: ${raw.slice(0, 300)}`;
      }
      const keyPath = String(args.key || "").split(".").map((k) => k.trim()).filter(Boolean);
      if (!keyPath.length) return 'FEHLER: key darf nicht leer sein (z. B. "feedbackChannelId" oder "config.channelId").';
      let value = args.value;
      if (typeof value === "string") {
        const t = value.trim();
        if (t === "true" || t === "false" || t === "null") value = t === "null" ? null : t === "true";
        else if (/^-?\d{1,15}(\.\d+)?$/.test(t)) value = Number(t);
        else if (t.length > 1 && t.startsWith('"') && t.endsWith('"') || t.length > 1 && t.startsWith("'") && t.endsWith("'")) value = t.slice(1, -1);
      }
      const createMissing = args.create_missing !== false;
      let node = obj;
      for (let i = 0; i < keyPath.length - 1; i++) {
        const k = keyPath[i];
        if (node[k] == null || typeof node[k] !== "object") {
          if (!createMissing) return `FEHLER: Schl\xFCssel \u201E${keyPath.slice(0, i + 1).join(".")}\u201C existiert nicht in ${rel}.`;
          node[k] = {};
        }
        node = node[k];
      }
      const lastKey = keyPath[keyPath.length - 1];
      const existed = Object.prototype.hasOwnProperty.call(node, lastKey);
      if (!existed && !createMissing) return `FEHLER: Schl\xFCssel \u201E${args.key}\u201C existiert nicht in ${rel}.`;
      const oldVal = existed ? node[lastKey] : "(neu)";
      await backupFile(root, toRel(root, p));
      node[lastKey] = value;
      const expected = JSON.stringify(obj, null, 2) + (raw.endsWith("\n") ? "\n" : "");
      await s.fs.writeFile(p, expected);
      try {
        const reread = await s.fs.readFile(p, 2e6);
        const parsed = JSON.parse(reread);
        let check = parsed;
        for (const k of keyPath) check = check?.[k];
        if (check !== value) return `FEHLER: ${rel} geschrieben, aber R\xFCcklesen zeigt ${JSON.stringify(check)} statt ${JSON.stringify(value)} \u2014 bitte pr\xFCfen.`;
        onDiff?.({ path: toRel(root, p), oldText: raw.slice(0, 8e4), newText: expected.slice(0, 8e4) });
        return `OK: ${toRel(root, p)} \u2014 ${args.key}: ${JSON.stringify(oldVal)} \u2192 ${JSON.stringify(value)} (JSON g\xFCltig, R\xFCcklesen verifiziert)`;
      } catch (e) {
        return `FEHLER: R\xFCck-Verifikation fehlgeschlagen: ${e.message}`;
      }
    }
    case "remember": {
      const scopeHash = root.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
      const scope = String(args.scope || "").toLowerCase() === "global" ? "global" : scopeHash;
      const kind = String(args.kind || "notiz");
      const title = String(args.title || "Notiz").slice(0, 200);
      const content = String(args.content || "");
      const verified = args.verified === true ? 1 : 0;
      run(
        "INSERT INTO knowledge (id, scope, kind, title, content, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), scope, kind, title, content, verified, Date.now()]
      );
      return `OK: gespeichert (${kind}: ${title}${verified ? ", verifiziert" : ""})`;
    }
    case "recall": {
      const scopeHash = root.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
      const q = `%${String(args.query || "").toLowerCase()}%`;
      const kind = args.kind ? String(args.kind) : null;
      const rows2 = kind ? query("SELECT title, kind, content, verified, created_at FROM knowledge WHERE (scope=? OR scope='global') AND kind=? AND lower(content||title) LIKE ? ORDER BY verified DESC, created_at DESC LIMIT 10", [scopeHash, kind, q]) : query("SELECT title, kind, content, verified, created_at FROM knowledge WHERE (scope=? OR scope='global') AND lower(content||title) LIKE ? ORDER BY verified DESC, created_at DESC LIMIT 10", [scopeHash, q]);
      if (!rows2.length) return "Keine passenden Eintr\xE4ge in der Wissensdatenbank.";
      return rows2.map((r) => `[${r.kind}${r.verified ? " \u2713verifiziert" : ""}] ${r.title}
${r.content}`).join("\n---\n");
    }
    case "rename_path": {
      await s.fs.renamePath(root, args.from, args.to);
      return `OK: ${args.from} \u2192 ${args.to}`;
    }
    case "mkdir": {
      await s.fs.mkdir(root, args.path);
      return `OK: Verzeichnis ${args.path} erstellt`;
    }
    case "run_command":
    case "run_test": {
      const cmd = String(args.command || "");
      const expectArg = String(args.expect ?? "");
      if (!expectArg.trim()) return 'FEHLER: Ung\xFCltiger Testaufruf \u2014 NICHT ausgef\xFChrt. expect darf nicht leer sein: Ohne erwartete Ausgabe ist das Ergebnis kein Nachweis (Schein-Test). Setze expect auf den erwarteten Ausgabetext (z. B. expect="OK" oder expect="42") oder nutze run_command f\xFCr reine Ausgabe.';
      if (DANGEROUS.test(cmd)) {
        const ok2 = onConfirm ? await onConfirm(cmd) : false;
        if (!ok2) return "ABGEBROCHEN: Der Nutzer hat diesen kritischen Befehl abgelehnt.";
      }
      const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      agentRuns.add(runId);
      let res;
      try {
        res = await s.term.run({ cwd: root, command: cmd, timeoutMs: 18e4, runId });
      } finally {
        agentRuns.delete(runId);
      }
      const expect = name === "run_test" ? expectArg : void 0;
      const expectExit = name === "run_test" && typeof args.expect_exit === "number" ? args.expect_exit : 0;
      const stdout = res.stdout || "";
      const expectMet = expect === void 0 ? void 0 : res.code === expectExit && stdout.includes(expect);
      cmdLog?.push({
        id: `${auftragId || "auftrag"}-c${(cmdLog?.length || 0) + 1}`,
        auftragId: auftragId || "auftrag",
        command: cmd,
        code: res.code,
        killed: res.killed,
        timedOut: res.timedOut,
        expect,
        expectMet,
        stdout: stdout.slice(-5e4),
        stderr: (res.stderr || "").slice(-5e4),
        ts: Date.now()
      });
      const out = stdout + (res.stderr ? "\n[stderr]\n" + res.stderr : "");
      const base = `Exit code: ${res.code}${res.killed ? " (ABGEBROCHEN)" : res.timedOut ? " (TIMEOUT)" : ""}
${out.slice(-12e3) || "(keine Ausgabe)"}`;
      if (name !== "run_test") return base;
      if (res.killed || res.timedOut) return `TEST ABGEBROCHEN (exit ${res.code}).
${base}`;
      const ok = expectMet === true;
      const verdict = ok ? `TEST BESTANDEN: Ausgabe enth\xE4lt die Erwartung "${expect}" (exit ${res.code} = erwartet ${expectExit}).` : `TEST FEHLGESCHLAGEN: ${expectMet === false ? res.code !== expectExit ? `Exit-Code ${res.code} \u2260 erwartet ${expectExit}` : `Ausgabe enth\xE4lt "${expect}" nicht \u2014 tats\xE4chliche Ausgabe: ${JSON.stringify(stdout.trim().slice(0, 300))}` : "Erwartung konnte nicht gepr\xFCft werden."}`;
      return `${verdict}
${base}`;
    }
    case "search_files": {
      const tree = await s.fs.listTree(root, { maxDepth: 8 });
      const q = String(args.query).toLowerCase();
      const sub = args.path ? toRel(root, abs(root, args.path)).toLowerCase() + "/" : "";
      const candidates = [];
      for (const n of tree) {
        if (n.isDir) continue;
        const npath = n.path.replace(/\\/g, "/");
        if (npath === ".aistudio" || npath.startsWith(".aistudio/") || npath.includes("/.aistudio/")) continue;
        if (sub && !npath.toLowerCase().includes(sub)) continue;
        if (/\.(png|jpg|jpeg|gif|webp|ico|zip|exe|dll|bin|wasm|mp[34]|woff2?)$/i.test(n.name)) continue;
        if (isProtectedPath(n.name)) continue;
        candidates.push(n.path);
        if (candidates.length >= 300) break;
      }
      const hits = [];
      const CHUNK = 8;
      outer: for (let i = 0; i < candidates.length; i += CHUNK) {
        const batch = candidates.slice(i, i + CHUNK);
        const contents = await Promise.all(batch.map(async (p) => {
          try {
            const st = await s.fs.stat(root, toRel(root, p));
            if (st.size > 4e5) return null;
            return await s.fs.readFile(p, 4e5);
          } catch {
            return null;
          }
        }));
        for (let k = 0; k < batch.length; k++) {
          const c = contents[k];
          if (c == null) continue;
          const idx = c.toLowerCase().indexOf(q);
          if (idx >= 0) {
            const line = c.slice(0, idx).split("\n").length;
            hits.push(`${toRel(root, batch[k])}:${line}`);
            if (hits.length >= 40) break outer;
          }
        }
      }
      if (!hits.length) {
        return "Keine Treffer" + (args.path ? " \u2014 Der angegebene Unterordner existiert m\xF6glicherweise nicht. Tipp: weglassen von path suchen (gesamtes Projekt) oder zuerst list_dir nutzen." : " \u2014 Tipp: anderen Suchbegriff versuchen oder den Dateinamen statt des Inhalts suchen (z. B. list_dir).");
      }
      return hits.join("\n") + "\n(Treffer = Datei:Zeile \u2014 zum Bearbeiten genau diesen Pfad verwenden)";
    }
    case "project_overview": {
      const tree = await s.fs.listTree(root, { maxDepth: 6 });
      const topDirs = /* @__PURE__ */ new Map();
      const exts = /* @__PURE__ */ new Map();
      const manifests = [];
      const LANG = {
        ".js": "JavaScript",
        ".jsx": "JavaScript/React",
        ".mjs": "JavaScript",
        ".cjs": "JavaScript",
        ".ts": "TypeScript",
        ".tsx": "TypeScript/React",
        ".py": "Python",
        ".java": "Java",
        ".c": "C",
        ".h": "C/C++",
        ".cpp": "C++",
        ".cc": "C++",
        ".hpp": "C++",
        ".cs": "C#",
        ".rs": "Rust",
        ".go": "Go",
        ".php": "PHP",
        ".html": "HTML",
        ".htm": "HTML",
        ".css": "CSS",
        ".scss": "SCSS",
        ".sql": "SQL",
        ".lua": "Lua",
        ".kt": "Kotlin",
        ".kts": "Kotlin",
        ".swift": "Swift",
        ".dart": "Dart",
        ".sh": "Bash",
        ".bash": "Bash",
        ".ps1": "PowerShell",
        ".vue": "Vue",
        ".svelte": "Svelte",
        ".rb": "Ruby",
        ".ex": "Elixir",
        ".exs": "Elixir",
        ".zig": "Zig"
      };
      const MANIFEST = /^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|manage\.py|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|Cargo\.toml|go\.(mod|sum)|composer\.(json|lock)|pubspec\.yaml|Gemfile|CMakeLists\.txt|Makefile|Dockerfile|docker-compose\.ya?ml|tsconfig\.json|.*\.(csproj|sln|fsproj|vbproj)|\.gitignore|\.env\.example)$/i;
      const projFiles = tree.filter((n) => !n.isDir).length;
      for (const n of tree) {
        const rel = toRel(root, n.path).replace(/\\/g, "/");
        if (n.isDir) {
          const depth = rel.split("/").length;
          if (depth <= 2) topDirs.set(rel, (topDirs.get(rel) || 0) + 1);
          continue;
        }
        if (MANIFEST.test(n.name)) manifests.push(rel);
        const ext = n.name.includes(".") ? n.name.slice(n.name.lastIndexOf(".")).toLowerCase() : "";
        const lang = LANG[ext];
        if (lang) exts.set(lang, (exts.get(lang) || 0) + 1);
      }
      const langStr = [...exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, c]) => `${l} (${c})`).join(", ") || "keine erkannt";
      const dirStr = [...topDirs.entries()].slice(0, 30).map(([d, c]) => `${d}: ${c}`).join(", ") || "(flache Struktur)";
      const hasGit = tree.some((n) => n.name === ".git");
      return `Projekt\xFCberblick (${projFiles} Dateien):
- Verzeichnisse: ${dirStr}
- Sprachen: ${langStr}
- Build-/Dep-Dateien: ${manifests.slice(0, 30).join(", ") || "keine"}
- Git-Repo: ${hasGit ? "ja" : "nein"}`;
    }
    case "git_status": {
      const runGit = async (cmd) => {
        try {
          const r = await s.term.run({ cwd: root, command: `git ${cmd}`, timeoutMs: 3e4 });
          return r.code === 0 ? (r.stdout || "(leer)").slice(0, 6e3) : `FEHLER (exit ${r.code}): ${(r.stderr || r.stdout || "").slice(0, 400)}`;
        } catch (e) {
          return `FEHLER: ${String(e?.message || e).slice(0, 300)}`;
        }
      };
      const branch = await runGit("rev-parse --abbrev-ref HEAD");
      if (/FEHLER/.test(branch)) return `Kein Git-Repository oder git nicht verf\xFCgbar: ${branch}`;
      const status = await runGit("status --short --branch");
      const log = await runGit("log --oneline -5");
      const diffstat = `${await runGit("diff --stat HEAD")}${await runGit("diff --stat --cached")}`;
      return `Git-Status (Branch: ${branch.trim()}):

[status]
${status}
[letzte Commits]
${log}
[diff-stat]
${diffstat}`;
    }
    case "web_search": {
      const q = encodeURIComponent(String(args.query || ""));
      const html = await (await fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, { signal: AbortSignal.timeout(15e3) })).text();
      const results = [];
      const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && results.length < 6) {
        const url = m[1].replace(/&amp;/g, "&");
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        results.push(`- ${title}
  ${url}`);
      }
      return results.length ? results.join("\n") : "Keine Suchergebnisse (Netzwerk/Blockade?)";
    }
    case "fetch_url": {
      const url = String(args.url || "");
      if (!/^https?:\/\//i.test(url)) return "FEHLER: Nur http(s)-URLs erlaubt.";
      const res = await fetch(url, { signal: AbortSignal.timeout(2e4), headers: { "User-Agent": "AIStudio/1.0" } });
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text.slice(0, 8e3) || "(leerer Inhalt)";
    }
    default:
      return `FEHLER: Unbekanntes Werkzeug: ${name}`;
  }
}
function parseJsonToolCall(content) {
  return parseJsonToolCalls(content)[0] || null;
}
function parseFunctionTagCalls(content) {
  const out = [];
  const re = /<function-name>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*<\/function-name>\s*<arguments>\s*([\s\S]*?)<\/arguments>/gi;
  let m;
  while ((m = re.exec(content)) && out.length < 8) {
    let args = {};
    try {
      args = JSON.parse(m[2].trim());
    } catch {
    }
    if (typeof args !== "object" || args === null) args = {};
    out.push({ name: m[1], arguments: args });
  }
  return out;
}
function parseJsonToolCalls(content) {
  const out = [];
  const nameRe = /"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  let m;
  while ((m = nameRe.exec(content)) && out.length < 8) {
    const name = m[1];
    const rest = content.slice(m.index);
    const argKey = rest.match(/"(?:arguments|parameters|args)"\s*:\s*/);
    if (!argKey || argKey.index === void 0) {
      nameRe.lastIndex = m.index + m[0].length;
      continue;
    }
    const start = m.index + argKey.index + argKey[0].length;
    const ch = content[start];
    let end = -1;
    const scan = (open, close) => {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < content.length; i++) {
        const c = content[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') inStr = !inStr;
        if (inStr) continue;
        if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            end = i + 1;
            return;
          }
        }
      }
    };
    if (ch === "{") scan("{", "}");
    else if (ch === "[") scan("[", "]");
    else {
      const sm = content.slice(start).match(/^("[^"]*"|-?\d+(?:\.\d+)?|true|false|null)/);
      if (sm) end = start + sm[0].length;
    }
    if (end < 0) {
      nameRe.lastIndex = m.index + m[0].length;
      continue;
    }
    const raw = content.slice(start, end);
    const stripComments = (t) => t.replace(/,\s*\/\/[^\n]*/g, ",").replace(/\n[ \t]*\/\/[^\n]*/g, "\n");
    const candidates = [
      raw,
      raw.replace(/\\'/g, "'"),
      stripComments(raw),
      raw.replace(/,\s*([}\]])/g, "$1"),
      stripComments(raw).replace(/,\s*([}\]])/g, "$1")
    ];
    for (const candidate of candidates) {
      try {
        const args = JSON.parse(candidate);
        if (typeof args === "object" && args !== null) {
          out.push({ name, arguments: args });
          break;
        }
      } catch {
      }
    }
    nameRe.lastIndex = end;
  }
  return out;
}
var SYSTEM = `Du bist ein Coding-Agent in einer Desktop-IDE. Du arbeitest AUSSCHLIESSLICH im freigegebenen Projektordner des Nutzers.
Verwende die bereitgestellten Werkzeuge, um Dateien zu lesen, zu schreiben, zu l\xF6schen, umzubenennen und Terminalbefehle auszuf\xFChren.
Regeln:
- Arbeite nur innerhalb des Projektordners. Verwende AUSSCHLIESSLICH relative Pfade (z. B. \u201Esrc/index.js") \u2014 niemals absolute Pfade, Laufwerksbuchstaben oder Prefixe wie \u201EProjekt:\u201C.
- Lies Dateien, bevor du sie \xE4nderst. Verstehe den Kontext mehrerer Dateien.
- Schreibe vollst\xE4ndige, lauff\xE4hige Dateien \u2014 keine Platzhalter.
- Bevorzuge kleine, gezielte \xC4nderungen.
- Nach \xC4nderungen: die ge\xE4nderte Datei erneut lesen (R\xFCck-Verifikation zeigt die Werkzeuge bereits), Syntax pr\xFCfen (z. B. python -m py_compile, node --check, tsc --noEmit) UND echte Funktionstests ausf\xFChren.
- F\xFCr Funktionstests IMMERVorrang f\xFCr run_test mit konkreter erwarteter Ausgabe (z. B. expect="42") \u2014 ein Exit-Code 0 allein beweist nicht, dass die Funktion korrekt ist.Teste die im Auftrag geforderten Beispiele UND Grenzf\xE4lle.
- Vergleiche die tats\xE4chliche Ausgabe mit der Anforderung. Weicht sie ab, ist der Test fehlgeschlagen \u2014 melde das ehrlich und repariere.
- Melde eine Aufgabe erst als erfolgreich, wenn die Pr\xFCfungen tats\xE4chlich liefen \u2014 unterscheide \u201Egetestet", \u201Eteilweise getestet" und \u201Enicht getestet".
- Bei Projektstart: nutze \u201Erecall\u201C, um gespeichertes Wissen \xFCber dieses Projekt UND geteiltes globales Wissen abzurufen. Speichere wichtige Erkenntnisse mit \u201Eremember\u201C \u2014 scope=\u201Eglobal\u201C f\xFCr \xFCbertragbares Wissen (Sprachen, Frameworks, allgemeine L\xF6sungen), scope=\u201Eprojekt\u201C f\xFCr projektspezifisches. verified=1 nur f\xFCr Wissen, das du durch echte Werkzeug-Ergebnisse (bestandene Tests, best\xE4tigte Fixes) belegt hast \u2014 niemals f\xFCr Vermutungen.
- Antworte am Ende kurz zusammenfassend auf Deutsch, was du ge\xE4ndert hast. Bei Such-/Analyseauftr\xE4gen nenne immer den TATS\xC4CHLICHEN Dateipfad aus dem Werkzeugergebnis \u2014 niemals einen geratenen.
- VERBOTEN: Bei Programmier-/\xC4nderungsauftr\xE4gen NIEMALS Code als Markdown-Codeblock in der Antwort ausgeben \u2014 das ist keine Umsetzung. Code geh\xF6rt ausschlie\xDFlich \xFCber write_file/edit_file/replace_lines in die Dateien. Deine Antwort beschreibt nur, was die Werkzeuge getan haben.
- Verwende NUR die bereitgestellten Werkzeugnamen \u2014 erfinde keine (z. B. kein \u201Ereplace_in_file" oder \u201Ecreate_new_file"; zum \xC4ndern write_file mit dem kompletten Inhalt nutzen).
- Behaupte keine \xC4nderung, die du nicht tats\xE4chlich per Werkzeug ausgef\xFChrt hast.
- F\xFChre bei Bedarf einen Befehl pro Antwort aus und warte auf das Ergebnis.
- Antworte NIEMALS mit erfundenen <tool_response>-Bl\xF6cken oder behaupteten Ausgaben \u2014 Tool-Ergebnisse liefert nur das System. Schreibst du einen Befehl, muss er \xFCber das run_command-Werkzeug laufen.
- F\xFChre Tests NIEMALS nur als Text oder in Codebl\xF6cken \u201Eaus" \u2014 das ist keine Ausf\xFChrung. Ein Test ist erst dann gelaufen, wenn du das Werkzeug run_test (mit erwarteter Ausgabe) oder run_command wirklich aufgerufen hast und das echte Ergebnis gelesen hast.
- F\xFChre keine Versionskontroll-Befehle aus (kein git commit/push/reset), wenn der Nutzer sie nicht ausdr\xFCcklich verlangt hat.
- Du bist ein vollst\xE4ndiger Entwickler-Agent: Du kannst neue Features, Dateien, Ordner, Skripte und ganze Programme selbstst\xE4ndig erstellen \u2014 der Code landet wirklich im Projekt, nicht nur im Chat.
- Arbeitsweise bei Programmierauftr\xE4gen: (1) Anforderungen verstehen, (2) bei gr\xF6\xDFeren Auftr\xE4gen oder Projektstart ZUERST project_overview aufrufen (ein Aufruf liefert Struktur, Sprachen, Build-Dateien), sonst list_dir/read_file/search_files, (3) kurze Vorgehensweise nennen, (4) Code mit write_file/edit_file/mkdir schreiben \u2014 mehrere Dateien bei Bedarf in einem Schritt, (5) mit run_command testen und Fehler reparieren, (6) am Ende kurz auf Deutsch erkl\xE4ren, was erstellt/ge\xE4ndert wurde.
- Unterst\xFCtzte Sprachen: JavaScript/TypeScript, Python, Java, C/C++, C#, Rust, Go, PHP, HTML/CSS, SQL, Lua, Kotlin, Swift, Dart, Bash/PowerShell und weitere \u2014 Syntax-Checks und Tests nutzen die jeweils passende Laufzeit (node, python, javac, go, cargo, dotnet o. \xE4., falls installiert).
- Erkenne Abh\xE4ngigkeiten aus package.json, requirements.txt, pom.xml, Cargo.toml, go.mod u. a. Installiere NIE Pakete ohne ausdr\xFCckliche Best\xE4tigung des Nutzers \u2014 melde fehlende Abh\xE4ngigkeiten stattdessen.
- Git: git_status ist ein sicheres Lese-Werkzeug (Branch, Status, Diff-Stat, letzte Commits) \u2014 f\xFCr Analyse nutzen. Mutationen (commit, push, checkout, reset, clean) nur \xFCber run_command UND nur wenn der Nutzer sie ausdr\xFCcklich verlangt \u2014 sie erfordern seine Best\xE4tigung.
- Ber\xFCcksichtige Imports, Abh\xE4ngigkeiten und bestehende Konventionen des Projekts. Lies relevante Dateien, bevor du sie \xE4nderst.
- Wenn search_files einen Treffer in einer Datei zeigt, bearbeite GENAU diese Datei (Pfad aus dem Suchergebnis \xFCbernehmen) \u2014 erfinde niemals Pfade wie \u201Econfig.json\u201C, wenn die Einstellung in \u201Econfig/settings.json\u201C liegt. Lies die gefundene Datei zuerst mit read_file.
- F\xFCr kleine \xC4nderungen an bestehenden Dateien (Wert tauschen, Zeile erg\xE4nnen, Text ersetzen) IMMER edit_file verwenden \u2014 niemals write_file, das w\xFCrde die gesamte Datei mit unvollst\xE4ndigem Inhalt \xFCberschreiben.
- JSON-Konfigurationen (Schl\xFCssel-Wert \xE4ndern, z. B. \u201EfeedbackChannelId auf X setzen"): BEVORZUGT set_json_value verwenden \u2014 es braucht keinen exakten alten Text, validiert JSON und pr\xFCft den Wert per R\xFCcklesen. edit_file nur f\xFCr Text-\xC4nderungen au\xDFerhalb von JSON-Werten.
- F\xFCr \xC4nderungen an bekannten Zeilen BEVORZUGT replace_lines verwenden: lies die Datei mit read_file (Zeilennummern sichtbar), gib start_line/end_line und den kompletten Ersatztext an \u2014 kein altes Text-Snippet n\xF6tig, daher zuverl\xE4ssiger als edit_file.
- edit_file nur verwenden, wenn du old_text EXAKT aus dem read_file-Ergebnis kopieren kannst (ohne Zeilennummern, mit korrekter Einr\xFCckung). Erfinde niemals Dateiinhalt.
- run_test: expect muss die EXAKTE erwartete Ausgabe der gepr\xFCften Funktion enthalten (z. B. expect="subtrahiere(5,3)= 2"), nicht nur irgendeine Zahl \u2014 eine schwache Erwartung wie expect="5" erkennt falsche Ergebnisse nicht. Pr\xFCfe bei mehreren Funktionen ALLE relevanten Ausgaben.
- Bevor du eine bestehende Datei mit edit_file oder write_file \xE4nderst, MUSST du sie in diesem Auftrag zuerst vollst\xE4ndig mit read_file gelesen haben \u2014 das System blockiert \xC4nderungen an ungelesenen Dateien.
- Bei edit_file-Fehlern (\u201Eold_text nicht gefunden\u201C) enth\xE4lt die Fehlermeldung den aktuellen Dateianfang \u2014 w\xE4hle old_text daraus EXAKT (inkl. Einr\xFCckung/Zeilenumbr\xFCche) und versuche es erneut, statt Erfolg zu behaupten.
- JSON-Dateien: nach dem Schreiben pr\xFCft das Werkzeug automatisch die Syntax \u2014 ein \u201EFEHLER: JSON-Syntax ung\xFCltig" bedeutet, die Datei wurde geschrieben, ist aber kaputt und muss sofort korrigiert werden.
- Eine Konfigurations\xE4nderung gilt erst als erledigt, wenn du die Datei danach erneut mit read_file gelesen hast und der NEUE Wert tats\xE4chlich im Inhalt steht. Behaupte niemals Erfolg ohne diesen Nachweis.
- Schl\xE4gt ein Werkzeugaufruf fehl (Ergebnis beginnt mit FEHLER/Fehler), analysiere die Ursache und versuche es mit korrigierten Argumenten \u2014 rate nicht einfach eine andere Datei.
- Lies niemals .env-Dateien oder Dateien mit Zugangsdaten \u2014 sie sind f\xFCr dich gesperrt. Gib keine Secrets aus.
- Wenn du unsicher bist oder etwas Gef\xE4hrliches n\xF6tig ist, frage nach statt zu raten.`;
async function runAgent(opts) {
  const { projectRoot, history, userMessage, onEvent, onConfirmCommand, signal } = opts;
  const empty = { changedFiles: [] };
  let settings = opts.settings;
  if (settings.provider === "local") {
    try {
      const { effectiveSettings: effectiveSettings2 } = await Promise.resolve().then(() => (init_llm(), llm_exports));
      settings = await effectiveSettings2(settings, "code");
    } catch (e) {
      onEvent({ type: "error", text: e.message });
      return empty;
    }
  }
  const provider = settings.provider;
  if (!["ollama", "custom", "openai"].includes(provider)) {
    onEvent({ type: "error", text: "Unbekannter Provider." });
    return empty;
  }
  const model = provider === "ollama" ? settings.ollamaModel : provider === "openai" ? settings.openaiModel : settings.customModel;
  const baseUrl = provider === "ollama" ? settings.ollamaUrl : provider === "openai" ? "https://api.openai.com/v1" : settings.customUrl;
  const apiKey = provider === "openai" ? settings.openaiKey : settings.customKey;
  if (!model) {
    onEvent({ type: "error", text: "Kein Modell ausgew\xE4hlt. Bitte in den Einstellungen ein Modell konfigurieren." });
    return empty;
  }
  if (!baseUrl) {
    onEvent({ type: "error", text: "Kein API-Endpunkt konfiguriert. Bitte in den Einstellungen den Provider-URL eintragen." });
    return empty;
  }
  let sandboxRoot;
  let workRoot = projectRoot;
  if (opts.sandbox) {
    try {
      const copy = await createSandboxCopy(projectRoot);
      if (!copy) {
        onEvent({ type: "error", text: "Sandbox konnte nicht erstellt werden (Projekt leer oder zu gro\xDF) \u2014 Auftrags abgebrochen, Original unver\xE4ndert." });
        return empty;
      }
      sandboxRoot = copy;
      workRoot = copy;
      onEvent({ type: "sandbox", text: copy });
    } catch (e) {
      onEvent({ type: "error", text: `Sandbox-Fehler: ${e.message} \u2014 Auftrags abgebrochen, Original unver\xE4ndert.` });
      return empty;
    }
  }
  const doStep = (msgs, tools, onTok) => provider === "ollama" ? ollamaAgentStep(settings.ollamaUrl, settings.ollamaModel, msgs, tools, onTok, signal) : openAIToolStep(baseUrl, apiKey, model, msgs, tools, onTok, signal);
  const messages = [
    { role: "system", content: `${SYSTEM}

Projektordner: ${workRoot}${opts.projectName ? ` (Projekt: ${opts.projectName})` : ""}${sandboxRoot ? `
(Hinweis: Dies ist eine Sandbox-Arbeitskopie \u2014 teste und \xE4ndere hier; das Original wird nur nach deiner Freigabe aktualisiert.)` : ""}` },
    ...history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ];
  const onAbort = () => {
    for (const id of agentRuns) {
      try {
        window.studio?.term?.kill(id);
      } catch {
      }
    }
    agentRuns.clear();
  };
  signal?.addEventListener("abort", onAbort);
  const failCounts = /* @__PURE__ */ new Map();
  const auftragId = `a${Date.now().toString(36)}`;
  const cmdLog = [];
  const changedFiles = /* @__PURE__ */ new Set();
  const CHANGE_INTENT = /(änder|bearbeit|erstell|schreib|ersetze|ersetzen|konfigurier|aktualisier|fix|reparier|beheb|hinzufüg|entfern|lösch|umbenenn|verschieb|optimier|verbesser|erweitere|implementier|anpass|korrektur|wert|einstellung|konfiguration|variable|parameter)/i.test(userMessage);
  let invalidTestCalls = 0;
  let repairFails = 0;
  let testNudges = 0;
  let codeNudges = 0;
  let repairNudges = 0;
  let autoCmdRuns = 0;
  let lastContentNorm = "";
  let fakeResponses = 0;
  let finalText = "";
  let finishedText = null;
  let hadError = false;
  const readFiles = /* @__PURE__ */ new Set();
  const normRel = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
  const fileFailCounts = /* @__PURE__ */ new Map();
  let maxFileFails = 0;
  try {
    for (let iter = 0; iter < 20; iter++) {
      if (signal?.aborted) {
        onEvent({ type: "done", text: "*(Vom Nutzer abgebrochen.)*" });
        return { sandboxRoot, changedFiles: [...changedFiles] };
      }
      const msg = await doStep(messages, TOOLS, (t) => onEvent({ type: "token", text: t }));
      messages.push(msg);
      if (msg.content) {
        const norm = msg.content.replace(/\s+/g, " ").trim().slice(0, 500);
        if (norm === lastContentNorm) {
          finishedText = finalText + "\n\n*(Abgebrochen: Das Modell wiederholt sich ohne Fortschritt.)*";
          break;
        }
        lastContentNorm = norm;
      } else {
        lastContentNorm = "";
      }
      if ((!msg.tool_calls || msg.tool_calls.length === 0) && provider !== "ollama") {
        const parsedAll = parseJsonToolCalls(msg.content || "");
        const tagCalls = parseFunctionTagCalls(msg.content || "");
        const merged = parsedAll.length ? parsedAll : tagCalls;
        if (merged.length) {
          msg.tool_calls = merged.map((p, i) => ({ id: `json-${i}`, function: { name: p.name, arguments: p.arguments } }));
          msg.content = "";
        }
      }
      const cleanContent = (msg.content || "").replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "").trim();
      if (cleanContent) finalText += cleanContent + "\n";
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        if (autoCmdRuns < 2 && msg.content && onConfirmCommand) {
          const plainText = msg.content.replace(/```[\s\S]*?```/g, " ").replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, " ").replace(/<function-name>[\s\S]*?<\/arguments>/gi, " ").replace(/<arguments>[\s\S]*?<\/arguments>/gi, " ");
          const m = plainText.match(/(?:run_command|run_test)\(\s*["'`]([^"'`]+)["'`]\s*[,)]/i) || plainText.match(/(?:^|\n)\s*((?:node|python3?|npm|npx|pytest|jest|vitest|go|cargo|dotnet|php)\s+[^\n]{0,300})/i) || plainText.match(/\b((?:node|python3?|npm|npx|pytest)\s+-e\s+"[^"]{1,300}"|(?:node|python3?)\s+[\w./\\-]+\.(?:js|mjs|cjs|py)\b[^\n]{0,200})/i);
          const cmdText = m?.[1]?.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"))?.split("`")[0].trim().slice(0, 400);
          if (cmdText && cmdText.length < 500) {
            autoCmdRuns++;
            const approved = await onConfirmCommand(`[Automatisch aus Modell-Text erkannt] ${cmdText}`);
            if (!approved) {
              const msg2 = "ABGEBROCHEN: Der aus dem Modelltext erkannte Befehl wurde nicht freigegeben.";
              onEvent({ type: "tool", name: "run_command", args: { command: cmdText, autoFromText: true }, result: msg2, ok: false });
              messages.push({ role: "tool", tool_call_id: `autocmd-${autoCmdRuns}`, content: msg2 });
              continue;
            }
            try {
              const result = await execTool("run_command", { command: cmdText }, workRoot, onConfirmCommand, cmdLog, auftragId);
              onEvent({ type: "tool", name: "run_command", args: { command: cmdText, autoFromText: true }, result: result.slice(0, 4e3), ok: !/^fehler|^abgebrochen/i.test(result) });
              messages.push({ role: "tool", tool_call_id: `autocmd-${autoCmdRuns}`, content: result });
              continue;
            } catch (e) {
              messages.push({ role: "tool", tool_call_id: `autocmd-${autoCmdRuns}`, content: `Fehler: ${e.message}` });
              continue;
            }
          }
        }
        const stripped = (msg.content || "").replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "").replace(/```[\s\S]*?```/g, "").trim();
        if (!stripped && /<tool_response>/i.test(msg.content || "")) {
          fakeResponses++;
          if (fakeResponses >= 2) {
            finishedText = finalText + "\n\n*(Abgebrochen: Das Modell hat wiederholt erfundene Tool-Antworten ausgegeben, ohne Werkzeuge auszuf\xFChren.)*";
            break;
          }
          messages.push({ role: "user", content: "Systemhinweis: Deine <tool_response>-Bl\xF6cke sind erfunden \u2014 sie kommen nicht vom System. Echtes Feedback erh\xE4ltst du nur \xFCber echte Werkzeugaufrufe. Bitte f\xFChre die n\xF6tigen Werkzeuge jetzt wirklich aus oder erkl\xE4re die Ursache." });
          continue;
        }
        fakeResponses = 0;
        const funcRan = cmdLog.some((c) => !c.auto && TEST_CMD_RE.test(c.command));
        const claimsSuccess = /(test|prüfung|run_test|ausgabe)[\s\S]{0,120}(bestanden|erfolgreich|korrekt|stimmt|überein)|((bestanden|erfolgreich|korrekt)[\s\S]{0,60}(test|prüfung))/i.test(msg.content || "");
        if (changedFiles.size > 0 && !funcRan && testNudges < 2 && iter < 18) {
          testNudges++;
          messages.push({
            role: "user",
            content: claimsSuccess ? "Systemhinweis (wichtig): Du behauptest einen bestandenen Test, aber im Protokoll ist KEIN Testlauf vorhanden. Das ist nicht erlaubt. F\xFChre JETZT ein echtes Werkzeug aus: run_test mit command und expect (erwarteter Ausgabe-Wert), lies das echte Ergebnis und berichte danach ehrlich." : 'Systemhinweis: Du hast Dateien ge\xE4ndert, aber noch keinen Funktionstest ausgef\xFChrt (ein Syntax-Check reicht nicht). F\xFChre jetzt mit run_test einen Test mit erwarteter Ausgabe aus (z. B. expect="42") oder run_command, pr\xFCfe die Ausgabe und bewerte das Ergebnis ehrlich.'
          });
          continue;
        }
        if (CHANGE_INTENT && changedFiles.size === 0 && codeNudges < 2 && /```/.test(msg.content || "") && iter < 18) {
          codeNudges++;
          messages.push({
            role: "user",
            content: "Systemhinweis (wichtig): Du hast Code nur als Text geschrieben \u2014 das \xE4ndert NICHTS im Projekt. Schreibe den Code jetzt wirklich mit den Werkzeugen: write_file f\xFCr neue Dateien, edit_file oder replace_lines f\xFCr \xC4nderungen an bestehenden Dateien (lies sie vorher mit read_file). Danach teste mit run_test."
          });
          continue;
        }
        const lastCmdFailed = (() => {
          const c = cmdLog[cmdLog.length - 1];
          return !!c && !c.auto && !c.killed && (c.code !== 0 || c.expectMet === false);
        })();
        if (lastCmdFailed && repairNudges < 1 && iter < 18) {
          repairNudges++;
          messages.push({
            role: "user",
            content: "Systemhinweis: Der letzte Test/Befehl ist FEHLGESCHLAGEN. Lies die Fehlerausgabe, analysiere die Ursache, lies die betroffene Datei erneut mit read_file, korrigiere sie (edit_file/replace_lines) und f\xFChre den Test erneut mit run_test aus \u2014 oder erkl\xE4re ehrlich, warum die Aufgabe nicht l\xF6sbar ist."
          });
          continue;
        }
        finishedText = finalText;
        break;
      }
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        let args = call.function.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        onEvent({ type: "tool", name, args });
        const sig = name + ":" + JSON.stringify(args);
        const fails = failCounts.get(sig) || 0;
        if (fails >= 3) {
          const msg2 = "FEHLER: Dieser identische Werkzeugaufruf ist bereits 3\xD7 fehlgeschlagen. Bitte w\xE4hle einen anderen Ansatz oder erkl\xE4re dem Nutzer die Ursache, statt es erneut zu versuchen.";
          onEvent({ type: "tool", name, args, result: msg2, ok: false });
          messages.push({ role: "tool", tool_call_id: call.id || name, content: msg2 });
          continue;
        }
        try {
          if ((name === "run_command" || name === "run_test") && typeof args?.command === "string") {
            const prevOk = cmdLog.filter((c) => !c.auto && c.command === args.command && c.code === 0).length;
            if (prevOk >= 2) {
              const last = [...cmdLog].reverse().find((c) => c.command === args.command);
              const msg2 = `Dieser Befehl wurde bereits ${prevOk}\xD7 erfolgreich ausgef\xFChrt (Exit 0). Letzte Ausgabe: ${((last?.stdout || "") + (last?.stderr ? "\n" + last.stderr : "")).slice(0, 800) || "(keine)"}. Bitte f\xFChre ihn nicht erneut aus.`;
              onEvent({ type: "tool", name, args, result: msg2, ok: true });
              messages.push({ role: "tool", tool_call_id: call.id || name, content: msg2 });
              continue;
            }
          }
          if ((name === "edit_file" || name === "write_file" || name === "set_json_value" || name === "replace_lines") && args && typeof args.path === "string" && args.path) {
            try {
              const targetRel = normRel(args.path);
              const exists = await studio().fs.exists(workRoot, args.path);
              if (exists && !readFiles.has(targetRel)) {
                const blockMsg = `FEHLER: Datei \u201E${args.path}\u201C wurde in diesem Auftrag noch nicht mit read_file gelesen. Lies sie zuerst komplett, identifiziere den tats\xE4chlichen Inhalt und wiederhole die \xC4nderung dann mit exakten Werten.`;
                onEvent({ type: "tool", name, args, result: blockMsg, ok: false });
                messages.push({ role: "tool", tool_call_id: call.id || name, content: blockMsg });
                continue;
              }
            } catch {
            }
          }
          const result = await execTool(
            name,
            args || {},
            workRoot,
            onConfirmCommand,
            cmdLog,
            auftragId,
            (d) => onEvent({ type: "filediff", path: d.path, oldText: d.oldText, newText: d.newText, ts: Date.now() })
          );
          const lastCmd = name === "run_command" || name === "run_test" ? cmdLog[cmdLog.length - 1] : null;
          const toolFailed = lastCmd ? lastCmd.code !== 0 || !!lastCmd.killed || lastCmd.expectMet === false : /^fehler|^abgebrochen|^test fehlgeschlagen/i.test(result) || result.includes("nicht in Datei gefunden");
          if (toolFailed) {
            failCounts.set(sig, fails + 1);
          } else {
            failCounts.delete(sig);
          }
          if (name === "read_file" && !toolFailed && args && typeof args.path === "string") {
            readFiles.add(normRel(args.path));
          }
          if (name === "edit_file" || name === "write_file" || name === "set_json_value" || name === "replace_lines") {
            const fk = `${name}|${normRel(args?.path)}`;
            if (toolFailed) {
              const c = (fileFailCounts.get(fk) || 0) + 1;
              fileFailCounts.set(fk, c);
              if (c > maxFileFails) maxFileFails = c;
            } else {
              fileFailCounts.delete(fk);
            }
          }
          onEvent({ type: "tool", name, args, result: result.slice(0, 4e3), ok: !toolFailed });
          if (!toolFailed && ["write_file", "delete_path", "rename_path", "edit_file", "set_json_value", "replace_lines"].includes(name)) {
            let rel = String(args.path || args.from || args.to);
            try {
              rel = toRel(workRoot, abs(workRoot, rel));
            } catch {
            }
            changedFiles.add(rel);
            onEvent({ type: "filechange", text: rel });
          }
          if (name === "run_test" && /nicht-leeren expect/.test(result)) invalidTestCalls++;
          if (name === "run_command" || name === "run_test") {
            const last = cmdLog[cmdLog.length - 1];
            if (last && (last.code !== 0 || last.expectMet === false) && !last.killed) repairFails++;
            else if (last && last.code === 0 && last.expectMet !== false) repairFails = 0;
          }
          messages.push({ role: "tool", tool_call_id: call.id || name, content: result.slice(0, 8e3) });
        } catch (e) {
          const err = `Fehler: ${e.message}`;
          onEvent({ type: "tool", name, args, result: err, ok: false });
          messages.push({ role: "tool", tool_call_id: call.id || name, content: err });
        }
      }
      if (repairFails >= 3) {
        finishedText = finalText + "\n\n*(Automatisch angehalten: 3 Testl\xE4ufe in Folge fehlgeschlagen \u2014 bitte den Fehler manuell pr\xFCfen.)*";
        break;
      }
      if (invalidTestCalls >= 2) {
        finishedText = finalText + "\n\n*(Abgebrochen: run_test wurde wiederholt ohne expect-Wert aufgerufen \u2014 das ist kein g\xFCltiger Test. Bitte erwartete Ausgabe angeben.)*";
        break;
      }
      if (maxFileFails >= 3) {
        finishedText = finalText + "\n\n*(Abgebrochen: 3 \xC4nderungsversuche an derselben Datei sind fehlgeschlagen \u2014 die Aufgabe gilt als NICHT erledigt. Bitte den Dateiinhalt pr\xFCfen und manuell vorgehen.)*";
        break;
      }
    }
    if (finishedText === null) {
      finishedText = finalText + "\n\n*(Maximale Schritte erreicht \u2014 Aufgabe ggf. unvollst\xE4ndig.)*";
    }
  } catch (e) {
    hadError = true;
    onEvent({ type: "error", text: e.message || String(e) });
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (hadError || signal?.aborted) return { sandboxRoot, changedFiles: [...changedFiles] };
  const report = await buildVerificationReport(workRoot, changedFiles, cmdLog, onEvent, signal, auftragId);
  onEvent({ type: "verify", text: report });
  const unverifiedClaim = !!(CHANGE_INTENT && changedFiles.size === 0);
  if (unverifiedClaim) {
    const claimsSuccess = /(erfolgreich|erledigt|geändert|erstellt|angepasst|abgeschlossen|fertig|implemented|done)/i.test(finishedText || "");
    finishedText += claimsSuccess ? "\n\n\u26A0 **Nachweis fehlt:** Der Text behauptet eine \xC4nderung, aber kein Schreib-Werkzeug (write_file / edit_file / replace_lines / set_json_value) wurde erfolgreich ausgef\xFChrt und r\xFCckgelesen. **Diese Aufgabe gilt als NICHT verifiziert.**" : "\n\n\u2139 **Hinweis:** F\xFCr diesen Auftrag wurde keine Datei\xE4nderung verifiziert (keine erfolgreichen Schreib-Werkzeugaufrufe).";
  }
  onEvent({ type: "done", text: finishedText + "\n\n" + report });
  try {
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    await studio().fs.writeFile(`${projectRoot}/.aistudio/berichte/agent-${ts}.md`, report);
    await studio().fs.writeFile(
      `${projectRoot}/.aistudio/berichte/agent-${ts}-commands.json`,
      JSON.stringify({ auftragId, projectRoot, createdAt: (/* @__PURE__ */ new Date()).toISOString(), commands: cmdLog }, null, 2)
    );
  } catch {
  }
  try {
    const agentCmds = cmdLog.filter((c) => !c.auto);
    if (agentCmds.length) {
      const funcOk = agentCmds.some((c) => TEST_CMD_RE.test(c.command) && c.code === 0 && c.expectMet !== false);
      const anyFail = agentCmds.some((c) => c.code !== 0 || c.expectMet === false);
      const kind = funcOk ? "testergebnis" : anyFail ? "fehler" : "notiz";
      const scopeHash = projectRoot.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
      const files = [...changedFiles].join(", ") || "keine";
      const cmds = agentCmds.map((c) => `${c.command} \u2192 exit ${c.code}${c.expectMet === false ? " (Erwartung verfehlt)" : ""}`).join("; ").slice(0, 400);
      const status = report.includes("bestanden") ? "bestanden" : report.includes("Fehlgeschlagen") ? "fehlgeschlagen" : "nicht getestet";
      run(
        "INSERT INTO knowledge (id, scope, kind, title, content, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          crypto.randomUUID(),
          scopeHash,
          kind,
          `Agent-Auftrag ${auftragId}: ${userMessage.slice(0, 100)}`,
          `Dateien: ${files}. Ausgef\xFChrte Befehle: ${cmds}. Ergebnis: ${status}.`,
          1,
          Date.now()
        ]
      );
    }
  } catch {
  }
  return { sandboxRoot, changedFiles: [...changedFiles], unverifiedClaim };
}
async function buildVerificationReport(root, changedFiles, cmdLog, onEvent, signal, auftragIdArg) {
  const s = studio();
  const lines = ["---", "### Verifikationsbericht", ""];
  const autoResults = [];
  for (const rel of changedFiles) {
    if (signal?.aborted) break;
    const ext = rel.split(".").pop()?.toLowerCase() || "";
    let checkCmd = null;
    if (ext === "py") checkCmd = `python -m py_compile "${rel}"`;
    else if (["js", "mjs", "cjs"].includes(ext)) checkCmd = `node --check "${rel}"`;
    else if (["ts", "tsx", "mts", "cts"].includes(ext)) checkCmd = `npx tsc --noEmit --skipLibCheck --module esnext --target es2020 "${rel}"`;
    else if (["sh", "bash"].includes(ext)) checkCmd = `bash -n "${rel}"`;
    else if (ext === "json") checkCmd = `node -e "JSON.parse(require('fs').readFileSync('${rel.replace(/'/g, "'")}','utf8'))"`;
    if (!checkCmd) continue;
    try {
      const exists = await s.fs.exists(root, rel);
      if (!exists) {
        autoResults.push({ file: rel, cmd: checkCmd, ok: false, detail: "Datei nicht (mehr) vorhanden" });
        continue;
      }
      const runId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      agentRuns.add(runId);
      let res;
      try {
        res = await s.term.run({ cwd: root, command: checkCmd, timeoutMs: 6e4, runId });
      } finally {
        agentRuns.delete(runId);
      }
      cmdLog.push({
        id: `${auftragIdArg || "auftrag"}-auto${cmdLog.length + 1}`,
        auftragId: auftragIdArg || "auftrag",
        command: checkCmd,
        code: res.code,
        killed: res.killed,
        timedOut: res.timedOut,
        auto: true,
        stdout: (res.stdout || "").slice(-5e4),
        stderr: (res.stderr || "").slice(-5e4),
        ts: Date.now()
      });
      onEvent({ type: "tool", name: "auto_check", args: { command: checkCmd }, result: `Exit ${res.code}`, ok: res.code === 0 });
      autoResults.push({
        file: rel,
        cmd: checkCmd,
        ok: res.code === 0,
        detail: res.code === 0 ? "bestanden" : `fehlgeschlagen (exit ${res.code})${res.stderr ? ": " + res.stderr.slice(0, 200) : ""}`
      });
    } catch (e) {
      autoResults.push({ file: rel, cmd: checkCmd, ok: false, detail: `Fehler: ${e.message}` });
    }
  }
  if (changedFiles.size) {
    lines.push(`**Ge\xE4nderte Dateien:** ${[...changedFiles].join(", ")}`, "");
  }
  const agentCmds = cmdLog.filter((c) => !c.auto);
  const autoCmds = cmdLog.filter((c) => c.auto);
  if (agentCmds.length) {
    lines.push(`**Vom Agenten ausgef\xFChrte Befehle** (Auftrag: ${auftragIdArg || "\u2014"}):`);
    for (const c of agentCmds) {
      const flag = c.killed ? " (abgebrochen)" : c.timedOut ? " (Timeout)" : c.code === 0 ? " \u2713" : " \u2717";
      const expectNote = c.expect !== void 0 ? ` \xB7 Erwartung "${c.expect.slice(0, 60)}": ${c.expectMet === true ? "\u2713 erf\xFCllt" : c.expectMet === false ? "\u2717 verfehlt" : "?"}` : "";
      lines.push(`- \`${c.id}\` \`${c.command}\` \u2192 Exit ${c.code}${flag}${expectNote} \xB7 ${new Date(c.ts).toLocaleTimeString("de-DE")}`);
      if (c.stdout?.trim()) lines.push(`  stdout: \`${c.stdout.trim().slice(0, 200)}\``);
      if (c.stderr?.trim()) lines.push(`  stderr: \`${c.stderr.trim().slice(0, 200)}\``);
    }
    lines.push("");
  }
  if (autoResults.length) {
    lines.push("**Automatische Syntaxpr\xFCfung** (kein Funktionstest):");
    for (const r of autoResults) {
      const rec = autoCmds.find((c) => c.command === r.cmd);
      lines.push(`- \`${rec?.id || "?"}\` \`${r.file}\`: ${r.cmd} \u2192 ${r.detail}`);
    }
    lines.push("");
  }
  if (!agentCmds.length && !autoResults.length) {
    lines.push("*Es wurden keine Terminalbefehle ausgef\xFChrt.*", "");
  }
  const agentCmdsAll = cmdLog.filter((c) => !c.auto);
  const funcTests = agentCmdsAll.filter((c) => TEST_CMD_RE.test(c.command));
  const failed = cmdLog.filter((c) => c.code !== 0 || c.expectMet === false);
  const passedFunc = funcTests.filter((c) => c.code === 0 && c.expectMet !== false);
  const expectChecked = funcTests.filter((c) => c.expect !== void 0 && c.expectMet === true);
  const passedOther = agentCmdsAll.filter((c) => c.code === 0 && c.expectMet !== false && !TEST_CMD_RE.test(c.command));
  let status;
  if (failed.length > 0) {
    status = "\u274C **Fehlgeschlagen** \u2014 mindestens ein Befehl endete mit Fehler oder verfehlte die erwartete Ausgabe (siehe oben)";
  } else if (expectChecked.length > 0) {
    status = `\u2705 **Funktionstest bestanden** \u2014 ${expectChecked.length} Test(s) mit best\xE4tigter erwarteter Ausgabe`;
  } else if (passedFunc.length > 0) {
    status = `\u2B1C **Kein Funktionstest protokolliert** \u2014 ${passedFunc.length} Testbefehl(e) liefen, aber ohne erwartete Ausgabe (kein Nachweis)`;
  } else if (passedOther.length > 0 || autoCmds.some((c) => c.code === 0)) {
    status = "\u2B1C **Kein Funktionstest protokolliert** \u2014 nur Syntax-Checks/allgemeine Befehlerfolge, kein Testbeweis";
  } else {
    status = "\u2B1C **Nicht ausgef\xFChrt** \u2014 kein Testlauf protokolliert";
  }
  lines.push(`**Status:** ${status}`, "");
  lines.push("*(Dieser Bericht wurde automatisch aus den tats\xE4chlichen Werkzeug-Ergebnissen dieses Auftrags erstellt \u2014 keine Modellbehauptung.)*");
  return lines.join("\n");
}
export {
  _rows,
  applySandboxChanges,
  buildVerificationReport,
  createSandboxCopy,
  discardSandbox,
  getBackupPath,
  parseFunctionTagCalls,
  parseJsonToolCall,
  parseJsonToolCalls,
  readBackup,
  runAgent
};
