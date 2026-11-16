import { Attachment } from './types';

// Laufzeit-Registry außerhalb der React-Komponenten.
// Überlebt Chat-Remounts (ChatView wird pro chatId neu gemountet), damit
// „einmal gesendet" auch über Chatwechsel hinweg gilt.

/** Pro Chat vorgemerkte Nachricht (z. B. Dashboard → neuer Chat). */
const pendingSends = new Map<string, { text: string; attachments: Attachment[]; mode?: string }>();

export function setPendingSend(chatId: string, text: string, attachments: Attachment[], mode?: string) {
  pendingSends.set(chatId, { text, attachments, mode });
}

/** Holt die vorgemerkte Nachricht genau einmal ab (atomar: delete vor return). */
export function takePendingSend(chatId: string): { text: string; attachments: Attachment[]; mode?: string } | null {
  const p = pendingSends.get(chatId);
  if (!p) return null;
  pendingSends.delete(chatId);
  return p;
}

/** Aktive Sende-Anfragen pro Chat (verhindert Doppel-Sends über Remounts). */
export const inflightSends = new Map<string, AbortController>();

/** Letzte vorgelesene Assistentenantwort pro Chat (verhindert Wiederholung nach Remount). */
export const spokenByChat = new Map<string, string>();

// Reaktive Benachrichtigung bei Änderungen des Sende-Status — damit eine
// neu gemountete ChatView „denken“ auch dann korrekt anzeigt, wenn die
// Anfrage aus einer vorherigen Instanz noch läuft.
const sendListeners = new Set<() => void>();
export function subscribeSendState(l: () => void): () => void {
  sendListeners.add(l);
  return () => sendListeners.delete(l);
}
export function notifySendState(): void {
  sendListeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}
