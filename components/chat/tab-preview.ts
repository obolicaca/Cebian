import { executeInTabWithArgs } from '@/lib/browser/tab-actions';
import { compactTabText, isReferenceableTab, tabLink, type TabReference } from '@/lib/agent/tab-references';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/ui/clipboard';
import { toast } from 'sonner';

export const QUOTE_PILL_STYLE = 'bg-info/10 text-info';

export const TAB_PILL_LAYOUT = 'chat-inline-pill max-w-[min(18rem,100%)]';
const PREVIEW_DESCRIPTION_LIMIT = 80;
export const TAB_TITLE_LINK_CLASS = 'min-w-0 truncate hover:underline focus-visible:underline underline-offset-2';

export async function openTabReference(reference: TabReference): Promise<void> {
  const url = tabLink(reference.url);
  if (!url) return;
  try {
    const original = await chrome.tabs.get(reference.tabId);
    if (original.url === url && (!original.pendingUrl || original.pendingUrl === url)) {
      const active = await chrome.tabs.update(reference.tabId, { active: true });
      if (active?.url === url && (!active.pendingUrl || active.pendingUrl === url)) {
        await chrome.windows.update(active.windowId, { focused: true });
        return;
      }
    }
  } catch {
    // The original tab can close while it is being activated.
  }
  await chrome.tabs.create({ url });
}

export function handleTabLinkClick(event: MouseEvent, reference: TabReference) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && event.target instanceof Node
    && (event.target.contains(selection.anchorNode) || event.target.contains(selection.focusNode))) return;
  void openTabReference(reference).catch(() => toast.error(t('errors.openTabFailed')));
}

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
  if (reference.bodyUnavailable || !isReferenceableTab(reference.url)) {
    return attachPillPreview(anchor, t('chat.composer.tabBodyUnavailable'), reference.url, undefined, 'compact', reference);
  }
  return attachPillPreview(anchor, reference.summary || t('chat.composer.tabPreviewUnavailable'), reference.url,
    reference.summary ? undefined : () => readDescription(reference), 'compact', reference);
}

export function attachPillPreview(anchor: HTMLElement, summary: string, detail?: string, loadDescription?: () => Promise<string>,
  textMode: 'compact' | 'full' | 'copyable' = 'compact', reference?: TabReference) {
  const fullText = textMode !== 'compact';
  const copyable = textMode === 'copyable';
  const href = reference && tabLink(reference.url);
  const interactive = fullText || !!href;
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
    clearTimeout(closeTimer);
    if (!interactive || !preview) hide();
    else closeTimer = setTimeout(() => {
      if (preview?.querySelector(':focus-visible')) return;
      hide();
    }, 220);
  };
  const show = (delay: number) => {
    clearTimeout(closeTimer);
    if (preview) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!anchor.isConnected) return;
      const panel = document.createElement('div');
      preview = panel;
      panel.role = interactive ? 'group' : 'tooltip';
      const label = reference?.title || (copyable && anchor.getAttribute('aria-label'));
      if (label) panel.setAttribute('aria-label', label);
      panel.className = 'fixed z-50 w-60 max-w-[calc(100vw-16px)] rounded-md border bg-popover p-2 text-xs leading-snug text-popover-foreground shadow-md ' +
        (interactive ? 'flex flex-col overflow-hidden' : 'pointer-events-none overflow-hidden');
      if (interactive) {
        panel.addEventListener('pointerenter', () => clearTimeout(closeTimer));
        panel.addEventListener('pointerleave', scheduleHide);
      }
      const description = document.createElement('div');
      description.className = fullText ? 'min-h-0 overflow-y-auto whitespace-pre-wrap break-words pr-1 [scrollbar-color:var(--muted-foreground)_transparent] [scrollbar-width:thin]' : 'break-words';
      if (fullText) description.tabIndex = 0;
      if (href) description.className = 'line-clamp-2 break-words px-1.5';
      description.textContent = fullText ? summary : compactTabText(summary, PREVIEW_DESCRIPTION_LIMIT);
      if (summary || loadDescription) panel.append(description);
      if (href || copyable) {
        const row = document.createElement('div');
        row.className = 'mt-1.5 flex shrink-0 items-center justify-end gap-1' + (href ? ' rounded-sm bg-muted pl-1.5' : '');
        if (href && reference) {
          const link = document.createElement('a');
          link.href = href;
          link.textContent = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.draggable = false;
          link.title = href;
          link.className = 'min-w-0 flex-1 cursor-pointer select-text truncate underline-offset-2 hover:underline focus-visible:underline';
          link.addEventListener('click', (event) => handleTabLinkClick(event, reference));
          row.append(link);
        }
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground';
        copy.title = href ? t('chat.composer.copyTabLink') : t('chat.composer.copyFullText');
        copy.setAttribute('aria-label', copy.title);
        const copyShape = '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('class', 'size-4 fill-none stroke-current');
        icon.setAttribute('stroke-width', '1.7');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = copyShape;
        copy.append(icon);
        let resetIcon: ReturnType<typeof setTimeout>;
        copy.addEventListener('click', async () => {
          if (!await copyText(href ?? summary) || !panel.isConnected) return;
          clearTimeout(resetIcon);
          icon.innerHTML = '<path d="m4 12 5 5L20 6" stroke-linecap="round" stroke-linejoin="round"/>';
          icon.classList.add('text-success');
          resetIcon = setTimeout(() => {
            icon.innerHTML = copyShape;
            icon.classList.remove('text-success');
          }, 1500);
        });
        row.append(copy);
        panel.append(row);
      } else if (detail) {
        const url = document.createElement('div');
        url.className = 'break-all text-[11px] text-muted-foreground' + (summary || loadDescription ? ' mt-1' : '');
        url.textContent = detail;
        panel.append(url);
      }
      if (interactive) {
        panel.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          anchor.querySelector<HTMLElement>('a, button')?.focus();
          hide();
        });
        panel.addEventListener('focusout', (event) => {
          if (!(event.relatedTarget instanceof Node) || !panel.contains(event.relatedTarget)) scheduleHide();
        });
      }
      document.body.append(panel);

      const position = () => {
        const rect = anchor.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        const spaceAbove = Math.max(0, rect.top - 14);
        const below = interactive && spaceAbove < 115 && window.innerHeight - rect.bottom - 14 > spaceAbove;
        const space = below ? window.innerHeight - rect.bottom - 14 : spaceAbove;
        panel.style.visibility = space ? 'visible' : 'hidden';
        panel.style.maxHeight = interactive ? `min(18rem, 50vh, ${space}px)` : `${space}px`;
        panel.style.top = (below ? rect.bottom + 6 : Math.max(8, rect.top - panel.offsetHeight - 6)) + 'px';
      };
      position();
      void loadDescription?.().then((text) => {
        if (preview !== panel || !text) return;
        description.textContent = compactTabText(text, PREVIEW_DESCRIPTION_LIMIT);
        position();
      });
    }, delay);
  };

  const onHover = () => show(1000);
  const onFocus = (event: FocusEvent) => { if (fullText || event.target instanceof HTMLAnchorElement) show(0); };
  const onBlur = (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget)) scheduleHide();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!preview || (!fullText && !(event.target instanceof HTMLAnchorElement))) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
    } else if (event.key === 'Tab' && !event.shiftKey && preview.style.visibility === 'visible') {
      const target = preview.querySelector<HTMLElement>('a, [tabindex]');
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
  };
  anchor.addEventListener('pointerenter', onHover);
  anchor.addEventListener('pointerleave', scheduleHide);
  if (interactive) {
    anchor.addEventListener('focusin', onFocus);
    anchor.addEventListener('focusout', onBlur);
    anchor.addEventListener('keydown', onKey);
  }
  return () => {
    hide();
    anchor.removeEventListener('pointerenter', onHover);
    anchor.removeEventListener('pointerleave', scheduleHide);
    anchor.removeEventListener('focusin', onFocus);
    anchor.removeEventListener('focusout', onBlur);
    anchor.removeEventListener('keydown', onKey);
  };
}
