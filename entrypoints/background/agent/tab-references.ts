import { compactTabText, findTabReferences, isReferenceableTab, tabReferenceToken } from '@/lib/agent/tab-references';
import { readPageTool } from '@/lib/tools/read-page';

export class TabReferenceError extends Error {
  constructor(readonly ids: string[], readonly reason: 'closed' | 'navigated' | 'unreadable' | 'read_failed' | 'budget') {
    super(reason);
  }
}

async function readTabBody(id: string, tabId: number, limit: number, timeout: number) {
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
      readPageTool.execute(id, { tabId, mode: 'markdown', maxLength: limit }, controller.signal),
      deadline,
    ]);
    return result.content.find((part) => part.type === 'text')?.text ?? '';
  } finally {
    clearTimeout(timer);
  }
}

export async function snapshotTabReferences(text: string, budget = 16000) {
  const tokens = findTabReferences(text);
  const sources = new Map<number, { url: string; title: string; body: string; truncated: boolean }>();
  if (tokens.length > 100) throw new TabReferenceError(tokens.map(({ ref }) => ref.id), 'read_failed');
  const pageCount = new Set(tokens.map(({ ref }) => ref.tabId)).size;
  const limit = Math.min(6000, Math.floor(budget / Math.max(1, pageCount)));
  if (limit < 100) throw new TabReferenceError(tokens.map(({ ref }) => ref.id), 'budget');
  const deadline = Date.now() + 25_000;
  let request = '';
  let cursor = 0;
  for (const { ref, from, to } of tokens) {
    const fail = (reason: TabReferenceError['reason']): never => {
      throw new TabReferenceError(tokens.filter((token) => token.ref.tabId === ref.tabId).map((token) => token.ref.id), reason);
    };
    if (!isReferenceableTab(ref.url)) fail('unreadable');
    const existing = sources.get(ref.tabId);
    if (existing && existing.url !== ref.url) fail('navigated');
    if (!existing) {
      const getTab = () => chrome.tabs.get(ref.tabId).catch(() => fail('closed'));
      const tab = await getTab();
      if (tab.url !== ref.url) fail('navigated');
      let body = '';
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) fail('read_failed');
        body = await readTabBody(ref.id, ref.tabId, limit + 1, Math.min(remaining, 10_000));
      } catch {
        if ((await getTab()).url !== ref.url) fail('navigated');
        fail('read_failed');
      }
      if ((await getTab()).url !== ref.url) fail('navigated');
      if (!body.trim()) fail('read_failed');
      const truncated = body.length > limit;
      if (truncated) {
        const boundary = body.lastIndexOf('\n\n', limit);
        body = body.slice(0, boundary > limit / 2 ? boundary : limit);
      }
      sources.set(ref.tabId, { title: tab.title ?? ref.title, url: ref.url, body, truncated });
    }
    const snapshot = sources.get(ref.tabId)!;
    const source = Array.from(sources.keys()).indexOf(ref.tabId) + 1;
    const summary = compactTabText(snapshot.body.replace(/^#{1,6}\s+.*$/gm, '').trim() || snapshot.body, 160);
    request += text.slice(cursor, from) + tabReferenceToken({ ...ref, title: snapshot.title, source, truncated: snapshot.truncated, summary });
    cursor = to;
  }
  const context = tokens.length
    ? JSON.stringify(Array.from(sources.values())).replaceAll('<', '\\u003c')
    : '';
  return { request: request + text.slice(cursor), context };
}
