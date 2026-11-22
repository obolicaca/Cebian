import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { vfs } from '@/lib/persistence/vfs';
import { installDefaultSkills } from './default-skills';

const skill = {
  name: 'default-seed-test',
  files: {
    'references/guide.md': 'reference',
    'SKILL.md': '---\nname: default-seed-test\ndescription: test\n---\nDefault instructions',
  },
};
const root = '~/.cebian/skills/default-seed-test';

describe('installDefaultSkills', () => {
  it('installs a complete Skill once and preserves later user edits', async () => {
    await installDefaultSkills([skill]);
    expect(await vfs.readFile(`${root}/SKILL.md`, 'utf8')).toContain('Default instructions');
    expect(await vfs.readFile(`${root}/references/guide.md`, 'utf8')).toBe('reference');

    await vfs.writeFile(`${root}/SKILL.md`, 'User instructions');
    await installDefaultSkills([{ ...skill, files: { ...skill.files, 'SKILL.md': 'New default' } }]);
    expect(await vfs.readFile(`${root}/SKILL.md`, 'utf8')).toBe('User instructions');
  });

  it('repairs a partial install without overwriting existing files', async () => {
    const partial = { ...skill, name: 'default-partial-test' };
    const partialRoot = '~/.cebian/skills/default-partial-test';
    await vfs.writeFile(`${partialRoot}/references/guide.md`, 'User reference');
    await installDefaultSkills([partial]);
    expect(await vfs.readFile(`${partialRoot}/references/guide.md`, 'utf8')).toBe('User reference');
    expect(await vfs.readFile(`${partialRoot}/SKILL.md`, 'utf8')).toContain('Default instructions');
  });
});
