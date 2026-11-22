import { defaultSkillPackages } from '@/lib/ai-config/bundled-skills';
import { installDefaultSkills } from '@/lib/ai-config/default-skills';

/** Install bundled Skills on first install and fill missing ones on upgrade. */
export function setupDefaultSkills(): void {
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install' && reason !== 'update') return;
    void installDefaultSkills(defaultSkillPackages).catch((error) =>
      console.error('[default-skills] installation failed:', error),
    );
  });
}
