import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabReference } from '@/lib/agent/tab-references';
import { openTabReference } from './tab-preview';

const url = 'https://example.test/guide?chapter=1';
const reference: TabReference = { id: 'ref', tabId: 12, title: 'Guide', url };
const tab = { id: 12, windowId: 24, url };
const get = vi.fn();
const update = vi.fn();
const create = vi.fn();
const focusWindow = vi.fn();

beforeEach(() => {
  get.mockReset().mockResolvedValue(tab);
  update.mockReset().mockResolvedValue(tab);
  create.mockReset().mockResolvedValue({});
  focusWindow.mockReset().mockResolvedValue({});
  vi.stubGlobal('chrome', { tabs: { get, update, create }, windows: { update: focusWindow } });
});

afterEach(() => vi.unstubAllGlobals());

describe('openTabReference', () => {
  it('activates the original tab and focuses its window if the URL still matches', async () => {
    await openTabReference(reference);
    expect(update).toHaveBeenCalledWith(12, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(24, { focused: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the original URL in a new tab if the source navigated', async () => {
    get.mockResolvedValue({ ...tab, url: 'https://example.test/other' });
    await openTabReference(reference);
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ url });
  });

  it('opens the original URL if the tab closed before activation', async () => {
    update.mockRejectedValue(new Error('Tab closed'));
    await openTabReference(reference);
    expect(create).toHaveBeenCalledWith({ url });
  });

  it('does not open unsafe protocols', async () => {
    await openTabReference({ ...reference, url: 'javascript:alert(1)' });
    expect(get).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
