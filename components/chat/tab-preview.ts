import { executeInTabWithArgs } from '@/lib/browser/tab-actions';
import { compactTabText, type TabReference } from '@/lib/agent/tab-references';
import { t } from '@/lib/i18n';

export const QUOTE_PILL_STYLE = 'bg-info/10 text-info';

export const TAB_PILL_LAYOUT = 'chat-inline-pill max-w-[min(18rem,100%)]';
export const COMPOSER_PREVIEW_CLASS = 'z-50 max-w-[calc(100vw-16px)] rounded-md border bg-popover p-2 text-xs leading-snug text-popover-foreground shadow-md';
const PREVIEW_DESCRIPTION_LIMIT = 80;

async function readDescription(reference: TabReference): Promise<string> {
  if (reference.summary) return reference.summary;
  try {
    const description = await executeInTabWithArgs(reference.tabId, (url) => {
      if (location.href !== url) return '';
      const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
      return (meta?.getAttribute('content')?.trim()
        || document.querySelector('main p, article p, p')?.textContent?.trim()
        || '').slice(0, 600);
    }, [reference.url]);
    return description ?? '';
  } catch {
    return '';
  }
}

export function attachTabPreview(anchor: HTMLElement, reference: TabReference) {
  return attachPillPreview(anchor, reference.summary || t('chat.composer.tabPreviewUnavailable'), reference.url,
    reference.summary ? undefined : () => readDescription(reference));
}

export function attachPillPreview(anchor: HTMLElement, summary: string, detail?: string, loadDescription?: () => Promise<string>, fullText = false) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let preview: HTMLDivElement | undefined;

  const hide = () => {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    preview?.remove();
    preview = undefined;
  };
  const scheduleHide = () => {
    clearTimeout(timer);
    if (!fullText || !preview) hide();
    else closeTimer = setTimeout(hide, 180);
  };
  const show = () => {
    hide();
    timer = setTimeout(() => {
      if (!anchor.isConnected) return;
      const panel = document.createElement('div');
      preview = panel;
      panel.role = 'tooltip';
      panel.className = `fixed w-60 ${COMPOSER_PREVIEW_CLASS} ` +
        (fullText ? 'overflow-y-auto' : 'pointer-events-none overflow-hidden');
      if (fullText) {
        panel.addEventListener('pointerenter', () => clearTimeout(closeTimer));
        panel.addEventListener('pointerleave', hide);
      }
      const description = document.createElement('div');
      description.className = fullText ? 'whitespace-pre-wrap break-words' : 'break-words';
      description.textContent = fullText ? summary : compactTabText(summary, PREVIEW_DESCRIPTION_LIMIT);
      if (summary || loadDescription) panel.append(description);
      if (detail) {
        const url = document.createElement('div');
        url.className = 'break-all text-[11px] text-muted-foreground' + (summary || loadDescription ? ' mt-1' : '');
        url.textContent = detail;
        panel.append(url);
      }
      document.body.append(panel);

      const position = () => {
        const rect = anchor.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        const spaceAbove = Math.max(0, rect.top - 14);
        panel.style.visibility = spaceAbove ? 'visible' : 'hidden';
        panel.style.maxHeight = fullText ? `min(18rem, 50vh, ${spaceAbove}px)` : `${spaceAbove}px`;
        panel.style.top = Math.max(8, rect.top - panel.offsetHeight - 6) + 'px';
      };
      position();
      void loadDescription?.().then((text) => {
        if (preview !== panel || !text) return;
        description.textContent = compactTabText(text, PREVIEW_DESCRIPTION_LIMIT);
        position();
      });
    }, 1000);
  };

  anchor.addEventListener('pointerenter', show);
  anchor.addEventListener('pointerleave', scheduleHide);
  return () => {
    hide();
    anchor.removeEventListener('pointerenter', show);
    anchor.removeEventListener('pointerleave', scheduleHide);
  };
}
