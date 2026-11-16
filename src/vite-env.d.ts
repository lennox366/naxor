/// <reference types="vite/client" />

declare global {
  interface Window {
    studio: {
      platform: string;
      isDev: boolean;
      win: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
      };
      fs: {
        readDir: (p: string) => Promise<{ name: string; path: string; isDir: boolean }[]>;
        readFile: (p: string, max?: number) => Promise<string>;
        readFileBase64: (p: string) => Promise<{ base64: string; size: number }>;
        writeFile: (p: string, c: string) => Promise<boolean>;
        pickFiles: (opts?: any) => Promise<string[]>;
        pickFolder: () => Promise<string | null>;
        saveFile: (name: string, content: string) => Promise<string | null>;
        listTree: (root: string, opts?: { maxDepth?: number }) => Promise<{ name: string; path: string; isDir: boolean; depth: number }[]>;
        deletePath: (root: string, rel: string) => Promise<boolean>;
        renamePath: (root: string, fromRel: string, toRel: string) => Promise<boolean>;
        mkdir: (root: string, rel: string) => Promise<boolean>;
        exists: (root: string, rel: string) => Promise<boolean>;
        stat: (root: string, rel: string) => Promise<{ size: number; isDir: boolean; mtime: number }>;
      };
      term: {
        run: (opts: { cwd?: string; command: string; timeoutMs?: number; runId?: string }) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean; killed?: boolean }>;
        kill: (runId: string) => Promise<boolean>;
        onChunk: (cb: (chunk: string) => void) => () => void;
      };
      llm: {
        start: (opts: { modelPath: string; port?: number; ctx?: number; mmproj?: string }) => Promise<{ ok: boolean; already?: boolean }>;
        stop: () => Promise<boolean>;
        status: () => Promise<{ running: boolean; modelPath: string | null; mmproj?: string | null; lastError?: string | null; logTail?: string }>;
      };
      sys: {
        info: () => Promise<{ cpus: number; cpuModel: string; cpuLoad: number; memTotal: number; memFree: number; platform: string; arch: string; hostname: string; uptime: number }>;
      };
      app: {
        paths: () => Promise<{ userData: string; filesDir: string; dbPath: string; isDev: boolean }>;
        openExternal: (url: string) => Promise<void>;
        revealPath: (p: string) => Promise<void>;
      };
    };
  }
}

export {};
