import React, { useMemo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

function highlight(code: string, lang: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
}

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: any) => {
  const language = (lang || '').trim();
  const highlighted = highlight(text.replace(/\n$/, ''), language);
  return `<pre><button class="copy-code" data-code="${encodeURIComponent(text)}">Kopieren</button><code class="hljs ${language ? 'language-' + language : ''}">${highlighted}</code></pre>`;
};

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text || '', { renderer }) as string;
    return DOMPurify.sanitize(raw);
  }, [text]);

  return (
    <div
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const btn = (e.target as HTMLElement).closest('.copy-code') as HTMLElement | null;
        if (!btn) return;
        const code = decodeURIComponent(btn.getAttribute('data-code') || '');
        navigator.clipboard.writeText(code);
        btn.textContent = 'Kopiert!';
        setTimeout(() => (btn.textContent = 'Kopieren'), 1200);
      }}
    />
  );
}
