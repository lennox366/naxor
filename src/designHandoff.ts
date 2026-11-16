// Übergabe von generiertem HTML aus dem Chat an das Design Studio.
let pending: { html: string; name: string } | null = null;

export function openDesignInStudio(html: string, name = 'chat-design') {
  pending = { html, name };
  window.dispatchEvent(new CustomEvent('studio:openDesign'));
}

export function takePendingDesign(): { html: string; name: string } | null {
  const p = pending;
  pending = null;
  return p;
}
