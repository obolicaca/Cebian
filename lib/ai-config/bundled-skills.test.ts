import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '@/lib/content/frontmatter';
import { defaultSkillPackages } from './bundled-skills';

describe('bundled default skills', () => {
  it('ships both discoverable entry files and the creator references', () => {
    expect(defaultSkillPackages.map((skill) => skill.name)).toEqual(['skill-creator', 'find-skills']);
    for (const skill of defaultSkillPackages) {
      const entry = skill.files['SKILL.md'];
      expect(entry).toBeTruthy();
      expect(parseFrontmatter(entry).data.name).toBe(skill.name);
    }
    expect(defaultSkillPackages[0].files['references/agentskills-spec.md']).toBeTruthy();
    expect(defaultSkillPackages[0].files['assets/skill-template/SKILL.md']).toBeTruthy();
  });
});
