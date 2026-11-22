import { vfs } from '@/lib/persistence/vfs';
import { CEBIAN_SKILLS_DIR, SKILL_ENTRY_FILE } from '@/lib/persistence/vfs-paths';
import { parseFrontmatter } from '@/lib/content/frontmatter';
import { escapeXml } from '@/lib/utils';

export interface SelectedSkill {
  name: string;
  filePath: string;
}
export interface ResolvedSkill { skill: SelectedSkill; body: string }
export const SELECTED_SKILLS_ONLY_REQUEST = 'Follow the selected skills above for this task. Ask for any missing input before acting.';

/** The client supplies identities, never trusted skill instructions. */
export async function resolveSelectedSkills(skills: readonly SelectedSkill[]): Promise<ResolvedSkill[]> {
  const seen = new Set<string>();
  const resolved: ResolvedSkill[] = [];
  for (const skill of skills) {
    const path = skill.filePath;
    const parts = path.split('/');
    if (parts.length !== 5 || path !== `${CEBIAN_SKILLS_DIR}/${parts[3]}/${SKILL_ENTRY_FILE}` || !parts[3] || parts[3] === '.' || parts[3] === '..' || seen.has(path)) {
      throw new Error(`Invalid or duplicate Skill: ${skill.name}`);
    }
    seen.add(path);
    try {
      const raw = await vfs.readFile(path, 'utf8');
      const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
      const { data, body } = parseFrontmatter(content);
      const name = typeof data.name === 'string' ? data.name : parts[3];
      const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : undefined;
      if (name !== skill.name || metadata?.disabled === true || !body.trim()) throw new Error('unavailable');
      resolved.push({ skill, body: content });
    } catch {
      throw new Error(`Skill missing, disabled, or unreadable: ${skill.name}`);
    }
  }
  return resolved;
}

export function buildSelectedSkillsBlock(resolved: readonly ResolvedSkill[]): string {
  if (!resolved.length) return '';
  return `<selected-skills>\n${resolved.map(({ skill, body }) => `<skill name="${escapeXml(skill.name, { forAttribute: true })}" path="${escapeXml(skill.filePath, { forAttribute: true })}">\n${escapeXml(body)}\n</skill>`).join('\n')}\n</selected-skills>`;
}

export function buildSelectedSkillNamesBlock(skills: readonly SelectedSkill[]): string {
  return `<selected-skills>\n${skills.map((skill) => `<skill name="${escapeXml(skill.name, { forAttribute: true })}" path="${escapeXml(skill.filePath, { forAttribute: true })}"></skill>`).join('\n')}\n</selected-skills>`;
}
