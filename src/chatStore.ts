import { Chat, Message } from './types';
import { query, run, uid } from './db';

export function listChats(): Chat[] {
  return query<Chat>('SELECT * FROM chats ORDER BY updated_at DESC');
}

export function getChat(id: string): Chat | null {
  const rows = query<Chat>('SELECT * FROM chats WHERE id = ?', [id]);
  return rows[0] || null;
}

export function createChat(title = 'Neuer Chat', mode = 'chat'): Chat {
  const now = Date.now();
  const chat: Chat = { id: uid(), title, mode, created_at: now, updated_at: now };
  run('INSERT INTO chats (id, title, mode, created_at, updated_at) VALUES (?,?,?,?,?)',
    [chat.id, chat.title, chat.mode, chat.created_at, chat.updated_at]);
  return chat;
}

export function renameChat(id: string, title: string) {
  run('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), id]);
}

export function deleteChat(id: string) {
  run('DELETE FROM messages WHERE chat_id = ?', [id]);
  run('DELETE FROM chats WHERE id = ?', [id]);
}

export function searchChats(q: string): Chat[] {
  const like = `%${q}%`;
  return query<Chat>(
    `SELECT c.* FROM chats c WHERE c.title LIKE ? OR EXISTS
     (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ?)
     ORDER BY c.updated_at DESC`, [like, like]);
}

export function getMessages(chatId: string): Message[] {
  return query<Message>('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid', [chatId]);
}

export function addMessage(chatId: string, role: string, content: string, meta?: any): Message {
  const m: Message = { id: uid(), chat_id: chatId, role: role as any, content, created_at: Date.now(), meta: meta ? JSON.stringify(meta) : undefined };
  run('INSERT INTO messages (id, chat_id, role, content, created_at, meta) VALUES (?,?,?,?,?,?)',
    [m.id, m.chat_id, m.role, m.content, m.created_at, m.meta || null]);
  run('UPDATE chats SET updated_at = ? WHERE id = ?', [m.created_at, chatId]);
  return m;
}

export function updateMessage(id: string, content: string, meta?: any) {
  if (meta !== undefined) run('UPDATE messages SET content = ?, meta = ? WHERE id = ?', [content, JSON.stringify(meta), id]);
  else run('UPDATE messages SET content = ? WHERE id = ?', [content, id]);
}

export function touchChat(id: string) {
  run('UPDATE chats SET updated_at = ? WHERE id = ?', [Date.now(), id]);
}

export function autoTitle(chatId: string, firstUserMsg: string) {
  const t = firstUserMsg.replace(/\s+/g, ' ').slice(0, 48);
  run('UPDATE chats SET title = ? WHERE id = ? AND title = ?', [t + (firstUserMsg.length > 48 ? '…' : ''), chatId, 'Neuer Chat']);
}
