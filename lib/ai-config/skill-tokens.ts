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
export function stripSkillTokens(text: string, tokens: readonly Pick<SkillToken, 'from' | 'to'>[]): string {
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
 * The open `/xxx` query the caret is editing, if any — the slash menu trigger.
 * The query starts at the nearest `/` before the caret (no whitespace or `/`
 * in between), so a slash typed mid-sentence opens the menu too; URLs are
 * guarded out. Complete Skill/Prompt pills are excluded: they are already
 * committed references, not an open query.
 */
export function findSlashToken(text: string, caret: number, tokens: readonly Pick<SkillToken, 'from' | 'to'>[]): SlashToken | null {
  // 查询段＝光标前最近一个 `/` 起、到光标为止不含空白与 `/` 的片段。不要求 `/` 在
  // 词首：中文行文「你好。/」与英文「hello/」都要能唤起菜单（行中斜杠触发）。
  let i = caret;
  while (i > 0 && !/\s/.test(text[i - 1]) && text[i - 1] !== '/') i--;
  if (i === 0 || text[i - 1] !== '/') return null;
  const from = i - 1;
  // URL 护栏：同一空白词里带 scheme（或 www. 开头）时不触发，敲网址不弹菜单。
  let ws = from;
  while (ws > 0 && !/\s/.test(text[ws - 1])) ws--;
  const whole = text.slice(ws, caret);
  if (whole.includes('://') || /^www\./i.test(whole)) return null;
  if (tokens.some((t) => t.from === from && t.to >= caret)) return null;
  return { from, to: caret, filter: text.slice(from + 1, caret).toLowerCase() };
}

/** A committed `/name` prompt reference in the composer doc. */
export interface PromptToken {
  name: string;
  /** Inclusive start offset in the doc string. */
  from: number;
  /** Exclusive end offset in the doc string. */
  to: number;
}

/**
 * Scan the composer doc for inline Prompt references. Same boundary rules as
 * {@link findSkillTokens}: doc start / whitespace before, whitespace / doc end
 * after, so URLs and suffixes never match. Only names in `promptNames` count —
 * the caller passes the picked prompt's name so typed-but-unpicked `/xxx`
 * stays literal text.
 */
export function findPromptTokens(text: string, promptNames: readonly string[]): PromptToken[] {
  const names = new Set(promptNames);
  const tokens: PromptToken[] = [];
  const re = /(?<!\S)\/([^\s/]+)(?!\S)/g;
  for (const match of text.matchAll(re)) {
    const name = match[1];
    if (!names.has(name)) continue;
    tokens.push({ name, from: match.index, to: match.index + match[0].length });
  }
  return tokens;
}