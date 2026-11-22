import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { isInjectablePage } from '@/lib/browser/tab-actions';
import { vfs } from '@/lib/persistence/vfs';
import { ensureOffscreen } from './offscreen';
import { readPageTool } from './read-page';
import { sessionSkillRoot } from './vfs-whitelist';
import type { PythonSkillPackageRequest, PythonSkillPackageResponse } from './python-skill-protocol';

const parameters = Type.Object({
  tabIds: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 8 }),
  name: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 }),
});

export function createPackageBrowserTabsTool(sessionId: string): AgentTool<typeof parameters> {
  return {
    name: 'package_browser_tabs',
    label: 'Package Browser Tabs',
    description: 'Create a searchable Skill ZIP in the session workspace from already open HTTP(S) tabs explicitly selected by the user. Requires the bundled experimental Chrome Python runtime.',
    parameters,
    async execute(callId, { tabIds, name }, signal) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || tabIds.length < 1 || tabIds.length > 8) {
        throw new Error('Invalid Skill name or tab count');
      }
      const pages = [];
      for (const tabId of new Set(tabIds)) {
        signal?.throwIfAborted();
        const tab = await chrome.tabs.get(tabId);
        if (tab.incognito || !tab.url || !isInjectablePage(tab.url)) throw new Error('This tab cannot be packaged');
        const result = await readPageTool.execute(callId, { tabId, mode: 'text', maxLength: 12000 }, signal);
        if ((await chrome.tabs.get(tabId)).url !== tab.url) throw new Error('The selected tab navigated while being read');
        const body = result.content.find((part) => part.type === 'text')?.text;
        if (!body?.trim()) throw new Error('The selected tab has no readable text');
        pages.push({ url: tab.url, title: tab.title || tab.url, body });
      }

      await ensureOffscreen();
      signal?.throwIfAborted();
      const request: PythonSkillPackageRequest = { type: 'python-skill:package', name, pages };
      const result: PythonSkillPackageResponse | undefined = await chrome.runtime.sendMessage(request);
      signal?.throwIfAborted();
      if (!result || 'error' in result) throw new Error(result?.error ?? 'Python packager did not respond');
      const bytes = Uint8Array.from(result.bytes);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Python packager returned an invalid ZIP');
      const path = sessionSkillRoot(sessionId, 'browser-python-demo') + '/' + name + '-' + crypto.randomUUID().slice(0, 8) + '.zip';
      await vfs.writeFile(path, bytes);
      return { content: [{ type: 'text', text: `Packaged ${pages.length} pages. [Download ${name}.zip](#${path})` }], details: {} };
    },
  };
}
