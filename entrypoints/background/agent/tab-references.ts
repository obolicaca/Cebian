import { compactTabText, findTabReferences, isReferenceableTab, tabLink, tabReferenceToken, type TabReference } from '@/lib/agent/tab-references';
import { readPageTool } from '@/lib/tools/read-page';

type TabSnapshot = { title: string; url?: string } & (
  | { body: string; truncated: boolean; bodyUnavailable?: never }
  | { body?: never; truncated?: never; bodyUnavailable: true }
);

async function readTabBody(id: string, tabId: number, mode: 'markdown' | 'text', limit: number, timeout: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Page read timed out'));
      }, timeout);
    });
    const result = await Promise.race([
      readPageTool.execute(id, { tabId, mode, maxLength: limit }, controller.signal),
      deadline,
    ]);
    const body = result.content.find((part) => part.type === 'text')?.text ?? '';
    return mode === 'text' && body === '(page has no body element)' ? '' : body;
  } finally {
    clearTimeout(timer);
  }
}

const sourceKey = (ref: TabReference) => `${ref.tabId}:${ref.url}`;

async function readSnapshot(ref: TabReference, limit: number, deadline: number): Promise<TabSnapshot> {
  const fallback = { title: ref.title, url: tabLink(ref.url), bodyUnavailable: true } as const;
  if (!isReferenceableTab(ref.url) || limit < 100 || Date.now() >= deadline) return fallback;
  const getMatchingTab = async () => {
    const tab = await chrome.tabs.get(ref.tabId).catch(() => undefined);
    return tab?.url === ref.url ? tab : undefined;
  };
  const tab = await getMatchingTab();
  if (!tab) return fallback;
  const tabDeadline = Math.min(deadline, Date.now() + 10_000);
  const remaining = tabDeadline - Date.now();
  if (remaining <= 0) return fallback;
  // Reserve part of the deadline for plain text if Markdown conversion hangs.
  let body = await readTabBody(ref.id, ref.tabId, 'markdown', limit + 1, Math.floor(remaining * 0.75)).catch(() => '');
  if (!body.trim()) {
    if (!await getMatchingTab()) return fallback;
    const textTime = tabDeadline - Date.now();
    if (textTime <= 0) return fallback;
    body = await readTabBody(ref.id, ref.tabId, 'text', limit + 1, textTime).catch(() => '');
  }
  if (!body.trim() || !await getMatchingTab()) return fallback;
  const truncated = body.length > limit;
  if (truncated) {
    const boundary = body.lastIndexOf('\n\n', limit);
    body = body.slice(0, boundary > limit / 2 ? boundary : limit);
  }
  return { title: tab.title ?? ref.title, url: fallback.url, body, truncated };
}

export async function snapshotTabReferences(text: string, budget = 16000) {
  const tokens = findTabReferences(text);
  const sources = new Map<string, { snapshot: TabSnapshot; index: number }>();
  const pageCount = new Set(tokens.filter(({ ref }) => isReferenceableTab(ref.url)).map(({ ref }) => sourceKey(ref))).size;
  const limit = Math.min(6000, Math.floor(budget / Math.max(1, pageCount)));
  const deadline = Date.now() + 25_000;
  let request = '';
  let cursor = 0;
  for (const { ref, from, to } of tokens) {
    const key = sourceKey(ref);
    let entry = sources.get(key);
    if (!entry) {
      entry = { snapshot: await readSnapshot(ref, limit, deadline), index: sources.size + 1 };
      sources.set(key, entry);
    }
    const { snapshot, index } = entry;
    const summary = snapshot.body && compactTabText(snapshot.body.replace(/^#{1,6}\s+.*$/gm, '').trim() || snapshot.body, 160);
    request += text.slice(cursor, from) + tabReferenceToken({
      id: ref.id, tabId: ref.tabId, title: snapshot.title, url: snapshot.url ?? '', source: index,
      truncated: snapshot.truncated, summary, bodyUnavailable: snapshot.bodyUnavailable,
    });
    cursor = to;
  }
  const context = sources.size
    ? JSON.stringify(Array.from(sources.values(), ({ snapshot }) => snapshot)).replaceAll('<', '\\u003c')
    : '';
  return { request: request + text.slice(cursor), context };
}
