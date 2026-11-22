import { isInjectablePage } from '@/lib/browser/tab-actions';

export function isReferenceableTab(url: string | undefined): boolean {
  if (!url || !isInjectablePage(url)) return false;
  try { return !new URL(url).pathname.toLowerCase().endsWith('.pdf'); } catch { return false; }
}

export interface TabReference {
  id: string;
  tabId: number;
  title: string;
  url: string;
  source?: number;
  truncated?: boolean;
  summary?: string;
}

export function compactTabText(text: string, limit: number): string {
  const characters = Array.from(text.replace(/\s+/gu, ' ').trim());
  return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : characters.join('');
}

export function tabReferenceToken(reference: TabReference): string {
  const label = reference.source ? `page ${reference.source}:` : '';
  return `⟦${label}cebian-tab:${encodeURIComponent(JSON.stringify(reference))}⟧`;
}

export function findTabReferences(text: string) {
  return Array.from(text.matchAll(/⟦(?:page \d+:)?cebian-tab:([^⟧\s]+)⟧/gu)).flatMap((match) => {
    try {
      const ref = JSON.parse(decodeURIComponent(match[1])) as TabReference;
      if (typeof ref.id !== 'string' || !Number.isInteger(ref.tabId)
        || typeof ref.title !== 'string' || typeof ref.url !== 'string') return [];
      return [{ ref, from: match.index, to: match.index + match[0].length }];
    } catch {
      return [];
    }
  });
}

export function splitTabReferenceContext(text: string) {
  const snapshot = text.match(/\n<tab-reference-data>([^\n]*)<\/tab-reference-data>$/u);
  return snapshot ? { request: text.slice(0, snapshot.index), context: snapshot[1] } : { request: text };
}

export function describeTabReferences(text: string) {
  const { request } = splitTabReferenceContext(text);
  return findTabReferences(request).reverse().reduce((result, { ref, from, to }) =>
    result.slice(0, from) + '@' + ref.title + result.slice(to), request);
}

export function tabLink(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}
