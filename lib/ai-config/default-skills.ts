import { vfs } from '@/lib/persistence/vfs';
import { CEBIAN_SKILLS_DIR, SKILL_ENTRY_FILE } from '@/lib/persistence/vfs-paths';

/** Files are bundled with the extension; an existing user copy always wins. */
export type DefaultSkillPackage = {
  name: string;
  files: Readonly<Record<string, string>>;
};

export async function installDefaultSkills(packages: readonly DefaultSkillPackage[]): Promise<void> {
  for (const skill of packages) {
    const root = `${CEBIAN_SKILLS_DIR}/${skill.name}`;
    if (await vfs.exists(`${root}/${SKILL_ENTRY_FILE}`)) continue;

    // On a previous interrupted install, preserve any user files and fill
    // only missing bundled files. Write SKILL.md last so the scanner never
    // indexes an incomplete package.
    const files = Object.entries(skill.files).sort(([a], [b]) =>
      a === SKILL_ENTRY_FILE ? 1 : b === SKILL_ENTRY_FILE ? -1 : a.localeCompare(b));
    for (const [relativePath, contents] of files) {
      if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Unsafe bundled skill path: ${relativePath}`);
      }
      const path = `${root}/${relativePath}`;
      if (await vfs.exists(path)) continue;
      await vfs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await vfs.writeFile(path, contents);
    }
  }
}
