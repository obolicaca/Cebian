import { executeInTabWithArgs } from '@/lib/browser/tab-actions';
import { compactTabText, type TabReference } from '@/lib/agent/tab-references';
import { t } from '@/lib/i18n';

export const TAB_PILL_LAYOUT = 'inline-block max-w-[min(18rem,100%)] truncate whitespace-nowrap align-bottom';
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

export function attachPillPreview(anchor: HTMLElement, summary: string, sourceUrl?: string, loadDescription?: () => Promise<string>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let preview: HTMLDivElement | undefined;

  const hide = () => {
    clearTimeout(timer);
    preview?.remove();
    preview = undefined;
  };
  const show = () => {
    hide();
    timer = setTimeout(() => {
      if (!anchor.isConnected) return;
      const panel = document.createElement('div');
      preview = panel;
      panel.role = 'tooltip';
      panel.className = 'pointer-events-none fixed z-50 w-60 max-w-[calc(100vw-16px)] rounded-md border bg-popover p-2 text-xs leading-snug text-popover-foreground shadow-md';
      const description = document.createElement('div');
      description.className = 'break-words';
      description.textContent = compactTabText(summary, PREVIEW_DESCRIPTION_LIMIT);
      panel.append(description);
      if (sourceUrl) {
        const url = document.createElement('div');
        url.className = 'mt-1 break-all text-[11px] text-muted-foreground';
        url.textContent = sourceUrl;
        panel.append(url);
      }
      document.body.append(panel);

      const position = () => {
        const rect = anchor.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        const below = rect.bottom + 6;
        panel.style.top = (below + panel.offsetHeight <= window.innerHeight - 8
          ? below : Math.max(8, rect.top - panel.offsetHeight - 6)) + 'px';
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
  anchor.addEventListener('pointerleave', hide);
  return () => {
    hide();
    anchor.removeEventListener('pointerenter', show);
    anchor.removeEventListener('pointerleave', hide);
  };
}
