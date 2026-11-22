import type { DefaultSkillPackage } from './default-skills';

const creatorFiles = import.meta.glob<string>('/skills/skill-creator/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const finderFiles = import.meta.glob<string>('/skills/find-skills/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function packageFiles(prefix: string, bundled: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(bundled).map(([path, contents]) => [path.slice(prefix.length), contents]));
}

export const defaultSkillPackages: readonly DefaultSkillPackage[] = [
  { name: 'skill-creator', files: packageFiles('/skills/skill-creator/', creatorFiles) },
  { name: 'find-skills', files: packageFiles('/skills/find-skills/', finderFiles) },
];
