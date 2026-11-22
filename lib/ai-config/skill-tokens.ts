import type { SelectedSkill } from './selected-skills';

/** A `/name` reference in the composer doc that resolves to an installed Skill. */
export interface SkillToken extends SelectedSkill {
  /** Inclusive start offset in the doc string. */
  from: number;
  /** Exclusive end offset in the doc string. */
  to: number;
}

export interface SkillNameRef {
  name: string;
  filePath: string;
}

/**
 * Scan the composer doc for inline Skill references.
 *
 * Boundary rules mirror the legacy typed-command path: a token starts at the
 * doc start or after whitespace and ends at whitespace or the doc end, so
 * URLs (`https://x/find-skills`) and suffixes (`/find-skills,`) never match.
 * Names that also exist as Prompts are excluded — the slash menu resolves
 * that conflict explicitly instead of silently pillifying.
 */
export function findSkillTokens(
  text: string,
  skills: readonly SkillNameRef[],
  promptNames: readonly string[],
): SkillToken[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const prompts = new Set(promptNames);
  const tokens: SkillToken[] = [];
  const re = /(?<!\S)\/([^\s/]+)(?!\S)/g;
  for (const match of text.matchAll(re)) {
    const name = match[1];
    const skill = byName.get(name);
    if (!skill || prompts.has(name)) continue;
    tokens.push({ name: skill.name, filePath: skill.filePath, from: match.index, to: match.index + match[0].length });
  }
  return tokens;
}

/** Ordered, de-duplicated Skills for the structured send path. */
export function tokensToSkills(tokens: readonly SkillToken[]): SelectedSkill[] {
  const seen = new Set<string>();
  const skills: SelectedSkill[] = [];
  for (const token of tokens) {
    if (seen.has(token.filePath)) continue;
    seen.add(token.filePath);
    skills.push({ name: token.name, filePath: token.filePath });
  }
  return skills;
}

/**
 * Remove token ranges (plus one trailing space each, mirroring the legacy
 * `/name ` strip) so the outgoing text carries only what the user typed.
 */
export function stripSkillTokens(text: string, tokens: readonly SkillToken[]): string {
  let out = text;
  for (const token of [...tokens].sort((a, b) => b.from - a.from)) {
    const end = out[token.to] === ' ' ? token.to + 1 : token.to;
    out = out.slice(0, token.from) + out.slice(end);
  }
  return out;
}

export interface SlashToken {
  from: number;
  to: number;
  filter: string;
}

/**
 * The `/xxx` word the caret is currently editing, if any — the slash menu
 * trigger. Complete Skill pills are excluded: they are already committed
 * references, not an open query.
 */
export function findSlashToken(text: string, caret: number, tokens: readonly SkillToken[]): SlashToken | null {
  let from = caret;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  if (from > 0 && !/\s/.test(text[from - 1])) return null;
  const word = text.slice(from, caret);
  if (!word.startsWith('/')) return null;
  if (tokens.some((t) => t.from === from && t.to >= caret)) return null;
  return { from, to: caret, filter: word.slice(1).toLowerCase() };
}
