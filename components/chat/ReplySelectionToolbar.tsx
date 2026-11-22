import { useEffect, useState, type RefObject } from 'react';
import { Clipboard, FileCode, Quote, Search } from 'lucide-react';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { browser } from 'wxt/browser';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { resolveSearchEnginesConfig, searchEnginesConfig } from '@/lib/persistence/storage';
import { buildSearchUrl, enabledSearchEngines } from '@/lib/search/engines';
import { copyText } from '@/lib/ui/clipboard';

interface SelectedReply {
  text: string;
  range: Range;
  block: Element;
  center: number;
  top: number;
  above: boolean;
}

function selectionToMarkdown({ range, block }: SelectedReply): string {
  let contents: Node = range.cloneContents();
  // A Range inside a single formatted element does not clone that element.
  let ancestor = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  while (ancestor && ancestor !== block) {
    const wrapper = ancestor.cloneNode(false);
    wrapper.appendChild(contents);
    contents = wrapper;
    ancestor = ancestor.parentElement;
  }
  const container = document.createElement('div');
  container.appendChild(contents);
  container.querySelectorAll('button, [data-copy-ignore]').forEach((node) => node.remove());
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  converter.use(gfm);
  return converter.turndown(container);
}

export function ReplySelectionToolbar({ root, onQuote }: {
  root: RefObject<HTMLDivElement | null>;
  onQuote: (text: string) => boolean;
}) {
  const [selected, setSelected] = useState<SelectedReply | null>(null);

  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
        setSelected(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const blockAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('[data-quote-source]');
      const block = blockAt(range.startContainer);
      const text = selection.toString();
      if (!block || !root.current?.contains(block) || block !== blockAt(range.endContainer) || !text.trim()) {
        setSelected(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const above = rect.top >= 72;
      setSelected({ text, block, range: range.cloneRange(), center: (rect.left + rect.right) / 2, top: above ? rect.top - 6 : rect.bottom + 6, above });
    };
    const dismiss = () => setSelected(null);
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('pointerup', update);
    const dismissCollapsed = () => { if (window.getSelection()?.isCollapsed) dismiss(); };
    document.addEventListener('selectionchange', dismissCollapsed);
    document.addEventListener('keydown', dismissOnEscape);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerup', update);
      document.removeEventListener('selectionchange', dismissCollapsed);
      document.removeEventListener('keydown', dismissOnEscape);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [root]);

  if (!selected) return null;
  const { text, center, top, above } = selected;
  const dismiss = () => {
    setSelected(null);
    window.getSelection()?.removeAllRanges();
  };
  const classes = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div role="toolbar" aria-label={t('chat.selectionActions')} className="fixed z-40 flex w-max max-w-[calc(100vw-16px)] flex-wrap items-center gap-1 rounded-lg border bg-popover p-1 text-xs shadow-md"
      ref={(element) => {
        if (!element) return;
        const width = element.offsetWidth;
        element.style.left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8)) + 'px';
      }}
      style={{ top, transform: above ? 'translateY(-100%)' : undefined }}
      onPointerUp={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className={classes} onClick={() => {
        dismiss();
        void copyText(text);
      }}><Clipboard className="size-3.5" />{t('chat.copyPlainText')}</button>
      <button type="button" className={classes} onClick={() => {
        try {
          const markdown = selectionToMarkdown(selected);
          dismiss();
          void copyText(markdown || text);
        } catch {
          toast.error(t('common.copyFailed'));
        }
      }}><FileCode className="size-3.5" />{t('chat.copySelectionMarkdown')}</button>
      <button type="button" className={classes} onClick={() => {
        if (onQuote(text)) setSelected(null);
      }}><Quote className="size-3.5" />{t('chat.quoteSelection')}</button>
      <button type="button" className={classes} onClick={async () => {
        try {
          const config = resolveSearchEnginesConfig(await searchEnginesConfig.getValue());
          const [preferred] = enabledSearchEngines(config);
          if (!preferred) {
            toast.error(t('settings.chat.search.allDisabled'));
            return;
          }
          await browser.tabs.create({ url: buildSearchUrl(preferred.urlTemplate, text) });
          dismiss();
        } catch {
          toast.error(t('errors.openTabFailed'));
        }
      }}><Search className="size-3.5" />{t('common.search')}</button>
    </div>
  );
}
