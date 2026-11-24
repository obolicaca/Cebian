import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTabReferences, tabReferenceToken } from '@/lib/agent/tab-references';
import { readPageTool } from '@/lib/tools/read-page';
import { snapshotTabReferences } from './tab-references';

vi.mock('@/lib/tools/read-page', () => ({ readPageTool: { execute: vi.fn() } }));

const url = 'https://example.test/guide/windows';
const tab = { url, title: 'Windows guide' };
const reference = tabReferenceToken({ id: 'ref-1', tabId: 12, title: tab.title, url });
const getTab = vi.fn();
const read = vi.mocked(readPageTool.execute);
const pageText = (text: string) => ({ content: [{ type: 'text' as const, text }], details: {} });

beforeEach(() => {
  getTab.mockReset().mockResolvedValue(tab);
  read.mockReset();
  vi.stubGlobal('chrome', { tabs: { get: getTab } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snapshotTabReferences', () => {
  it('uses Markdown when available', async () => {
    read.mockResolvedValueOnce(pageText('## Guide'));
    const { context } = await snapshotTabReferences(reference);
    expect(JSON.parse(context)).toMatchObject([{ body: '## Guide', url }]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'empty'] as const)('falls back to visible text when Markdown returns %s', async (failure) => {
    if (failure === 'error') read.mockRejectedValueOnce(new Error('Offscreen conversion unavailable'));
    else read.mockResolvedValueOnce(pageText('   '));
    read.mockResolvedValueOnce(pageText('Visible installation instructions'));
    const { request, context } = await snapshotTabReferences(reference + ' summarize');
    expect(request).toMatch(/page 1:.* summarize$/);
    expect(JSON.parse(context)).toMatchObject([{ body: 'Visible installation instructions', title: 'Windows guide', url }]);
    expect(read.mock.calls.map(([, params]) => params.mode)).toEqual(['markdown', 'text']);
  });

  it('never falls back to the contents of a page that has navigated', async () => {
    read.mockRejectedValueOnce(new Error('Offscreen conversion unavailable'));
    getTab.mockResolvedValueOnce(tab).mockResolvedValueOnce({ url: 'https://example.test/different' });
    const { context } = await snapshotTabReferences(reference);
    expect(JSON.parse(context)).toEqual([{ title: tab.title, url, bodyUnavailable: true }]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reserves time for plain text if Markdown conversion hangs', async () => {
    vi.useFakeTimers();
    try {
      read.mockImplementationOnce(() => new Promise(() => {}));
      read.mockResolvedValueOnce(pageText('Visible instructions'));
      const snapshot = snapshotTabReferences(reference);
      await vi.advanceTimersByTimeAsync(7500);
      expect(JSON.parse((await snapshot).context)).toMatchObject([{ body: 'Visible instructions' }]);
      expect(read.mock.calls[0][2]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the question and a link when the browser denies both reads', async () => {
    read.mockRejectedValue(new Error('Cannot access contents of the page'));
    const { context, request } = await snapshotTabReferences(reference + ' my question');
    expect(JSON.parse(context)).toEqual([{ title: tab.title, url, bodyUnavailable: true }]);
    expect(findTabReferences(request)[0]?.ref).toMatchObject({ source: 1, bodyUnavailable: true });
    expect(request).toMatch(/ my question$/);
  });

  it('retains good sources next to restricted tabs and omits private URL schemes', async () => {
    const localUrl = 'file:///Users/test/private.txt';
    const localTab = tabReferenceToken({ id: 'local', tabId: 13, title: 'Local file', url: localUrl });
    read.mockResolvedValueOnce(pageText('Readable instructions'));
    const { context, request } = await snapshotTabReferences(localTab + ' ' + reference);
    expect(JSON.parse(context)).toMatchObject([
      { title: 'Local file', bodyUnavailable: true },
      { url, body: 'Readable instructions' },
    ]);
    expect(context).not.toContain(localUrl);
    expect(findTabReferences(request).map(({ ref }) => ref.url)).toEqual(['', url]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('sends title and URL when no body budget remains', async () => {
    const { context } = await snapshotTabReferences(reference, 0);
    expect(JSON.parse(context)).toMatchObject([{ url, bodyUnavailable: true }]);
    expect(read).not.toHaveBeenCalled();
  });

  it('sends the original reference when the tab has been closed', async () => {
    getTab.mockRejectedValue(new Error('Tab not found'));
    const { context } = await snapshotTabReferences(reference);
    expect(JSON.parse(context)).toMatchObject([{ title: tab.title, url, bodyUnavailable: true }]);
    expect(read).not.toHaveBeenCalled();
  });
});
