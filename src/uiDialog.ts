// window.confirm/alert/prompt werden in Electron nicht unterstützt.
// Diese Helfer nutzen den nativen Dialog über IPC (studio.dialog)
// und fallen im Browser-Kontext auf window.confirm/alert zurück.

export async function uiConfirm(message: string, detail?: string, danger = false): Promise<boolean> {
  try {
    const d = (window as any).studio?.dialog;
    if (d?.confirm) return !!(await d.confirm(message, detail, danger));
  } catch { /* Bridge nicht verfügbar */ }
  try { return window.confirm(message); } catch { return false; }
}

export async function uiAlert(message: string, detail?: string): Promise<void> {
  try {
    const d = (window as any).studio?.dialog;
    if (d?.alert) { await d.alert(message, detail); return; }
  } catch { /* Bridge nicht verfügbar */ }
  try { window.alert(message); } catch { /* ignored */ }
}
