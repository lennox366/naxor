import React from 'react';
import { Copy, Volume2, Square, Paperclip } from 'lucide-react';
import { Message, Attachment } from '../types';
import { Markdown } from './Markdown';
import { AgentActivity } from './AgentActivity';
import { openDesignInStudio } from '../designHandoff';
import { Palette } from 'lucide-react';
import { Logo } from './Logo';

interface Props {
  msg: Message;
  onSpeak?: (text: string, id: string) => void;
  speakingId?: string | null;
  onStopSpeak?: () => void;
}

export function MessageBubble({ msg, onSpeak, speakingId, onStopSpeak }: Props) {
  const isUser = msg.role === 'user';
  let attachments: Attachment[] = [];
  let agentEvents: any[] = [];
  try {
    const meta = msg.meta ? JSON.parse(msg.meta) : {};
    attachments = meta.attachments || [];
    agentEvents = meta.agentEvents || [];
  } catch {}

  // HTML-Design im Chat → Button „Im Design Studio öffnen"
  const htmlBlock = !isUser && msg.content?.match(/```(?:html)?\n([\s\S]*?)```/);
  const openDesign = () => {
    if (!htmlBlock) return;
    openDesignInStudio(htmlBlock[1], 'chat-design');
  };

  return (
    <div className={`msg ${msg.role}`}>
      <div className="avatar">{isUser ? 'Du' : <Logo size={22} />}</div>
      <div className="body">
        <div className="bubble">
          {attachments.map((a, i) =>
            a.dataUrl && a.mime?.startsWith('image/') ? (
              <img key={i} src={a.dataUrl} alt={a.name} className="attach-preview" />
            ) : null
          )}
          {attachments.filter(a => !(a.dataUrl && a.mime?.startsWith('image/'))).map((a, i) => (
            <div key={i} className="attach-name"><Paperclip size={11} /> {a.name}</div>
          ))}
          {msg.content ? <Markdown text={msg.content} /> : null}
          {agentEvents.length > 0 && <AgentActivity events={agentEvents} />}
        </div>
        <div className="meta-row">
          <button
            className="mini-btn"
            onClick={() => navigator.clipboard.writeText(msg.content)}
          ><Copy /> Kopieren</button>
          {!isUser && onSpeak && (
            <button
              className="mini-btn"
              onClick={() => {
                if (speakingId === msg.id) onStopSpeak?.();
                else onSpeak(msg.content, msg.id);
              }}
            >{speakingId === msg.id ? <><Square size={10} fill="currentColor" /> Stopp</> : <><Volume2 /> Vorlesen</>}</button>
          )}
          {htmlBlock && (
            <button className="mini-btn" onClick={openDesign} title="HTML-Design im Design Studio öffnen (Vorschau, Iteration, Export)"><Palette size={11} /> Im Design Studio</button>
          )}
        </div>
      </div>
    </div>
  );
}
