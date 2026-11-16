const { contextBridge, ipcRenderer } = require('electron');

const api = {
  platform: process.platform,
  isDev: !process.env.ELECTRON_RENDERER_URL,

  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  },

  fs: {
    readDir: (p) => ipcRenderer.invoke('fs:readDir', p),
    readFile: (p, max) => ipcRenderer.invoke('fs:readFile', p, max),
    readFileBase64: (p) => ipcRenderer.invoke('fs:readFileBase64', p),
    writeFile: (p, c) => ipcRenderer.invoke('fs:writeFile', p, c),
    pickFiles: (opts) => ipcRenderer.invoke('fs:pickFiles', opts),
    pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
    saveFile: (name, content) => ipcRenderer.invoke('fs:saveFile', name, content),
    listTree: (root, opts) => ipcRenderer.invoke('fs:listTree', root, opts),
    deletePath: (root, rel) => ipcRenderer.invoke('fs:deletePath', root, rel),
    renamePath: (root, fromRel, toRel) => ipcRenderer.invoke('fs:renamePath', root, fromRel, toRel),
    mkdir: (root, rel) => ipcRenderer.invoke('fs:mkdir', root, rel),
    exists: (root, rel) => ipcRenderer.invoke('fs:exists', root, rel),
    stat: (root, rel) => ipcRenderer.invoke('fs:stat', root, rel),
  },

  term: {
    run: (opts) => ipcRenderer.invoke('term:run', opts),
    kill: (runId) => ipcRenderer.invoke('term:kill', runId),
    onChunk: (cb) => {
      const l = (_e, chunk) => cb(chunk);
      ipcRenderer.on('term:chunk', l);
      return () => ipcRenderer.removeListener('term:chunk', l);
    },
  },

  dialog: {
    confirm: (message, detail, danger) => ipcRenderer.invoke('dialog:confirm', { message, detail, danger }),
    alert: (message, detail) => ipcRenderer.invoke('dialog:alert', { message, detail }),
  },

  app: {
    paths: () => ipcRenderer.invoke('app:paths'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    revealPath: (p) => ipcRenderer.invoke('app:revealPath', p),
  },

  llm: {
    start: (opts) => ipcRenderer.invoke('llm:start', opts),
    stop: () => ipcRenderer.invoke('llm:stop'),
    status: () => ipcRenderer.invoke('llm:status'),
  },

  sys: {
    info: () => ipcRenderer.invoke('sys:info'),
  },

  tts: {
    elevenlabs: (opts) => ipcRenderer.invoke('tts:elevenlabs', opts),
    edge: (opts) => ipcRenderer.invoke('tts:edge', opts),
  },
};

contextBridge.exposeInMainWorld('studio', api);
