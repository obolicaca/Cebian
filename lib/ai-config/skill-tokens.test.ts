import { describe, expect, it } from 'vitest';
import { findSkillTokens, findSlashToken, stripSkillTokens, tokensToSkills } from './skill-tokens';

const skills = [
  { name: 'alpha-skill', filePath: '~/.cebian/skills/alpha-skill/SKILL.md' },
  { name: 'beta-skill', filePath: '~/.cebian/skills/beta-skill/SKILL.md' },
];

describe('findSkillTokens', () => {
  it('matches tokens at doc start, mid-text, and after newlines', () => {
    const text = '/alpha-skill please use /beta-skill\nand /alpha-skill again';
    const tokens = findSkillTokens(text, skills, []);
    expect(tokens.map((t) => t.name)).toEqual(['alpha-skill', 'beta-skill', 'alpha-skill']);
    expect(text.slice(tokens[0].from, tokens[0].to)).toBe('/alpha-skill');
    expect(text.slice(tokens[1].from, tokens[1].to)).toBe('/beta-skill');
  });

  it('ignores URLs, trailing punctuation, and embedded slashes', () => {
    const text = 'see https://x/alpha-skill or /alpha-skill, or /alpha-skill/x or x/alpha-skill';
    expect(findSkillTokens(text, skills, [])).toEqual([]);
  });

  it('ignores unknown names and names that are also Prompts', () => {
    expect(findSkillTokens('/unknown /alpha-skill', skills, [])).toEqual([
      expect.objectContaining({ name: 'alpha-skill', from: 9 }),
    ]);
    expect(findSkillTokens('/alpha-skill', skills, ['alpha-skill'])).toEqual([]);
  });
});

describe('tokensToSkills', () => {
  it('dedups by filePath keeping first-seen order', () => {
    const tokens = findSkillTokens('/beta-skill /alpha-skill /beta-skill', skills, []);
    expect(tokensToSkills(tokens)).toEqual([
      { name: 'beta-skill', filePath: skills[1].filePath },
      { name: 'alpha-skill', filePath: skills[0].filePath },
    ]);
  });
});

describe('stripSkillTokens', () => {
  it('removes each token plus one trailing space', () => {
    const text = 'use /alpha-skill now and /beta-skill later';
    expect(stripSkillTokens(text, findSkillTokens(text, skills, []))).toBe('use now and later');
  });

  it('handles doc-end tokens and multiple adjacent tokens', () => {
    const text = '/alpha-skill /beta-skill';
    expect(stripSkillTokens(text, findSkillTokens(text, skills, []))).toBe('');
    // 词前空格保留（发送端统一 trim），只吃掉 token 及其后一个空格。
    expect(stripSkillTokens('tail /alpha-skill', findSkillTokens('tail /alpha-skill', skills, []))).toBe('tail ');
  });

  it('leaves token-free text untouched', () => {
    expect(stripSkillTokens('plain text', [])).toBe('plain text');
  });
});

describe('findSlashToken', () => {
  it('returns the open query at doc start and mid-text', () => {
    expect(findSlashToken('/alp', 4, [])).toEqual({ from: 0, to: 4, filter: 'alp' });
    expect(findSlashToken('hello /alp', 10, [])).toEqual({ from: 6, to: 10, filter: 'alp' });
    expect(findSlashToken('/', 1, [])).toEqual({ from: 0, to: 1, filter: '' });
  });

  it('returns null outside slash words', () => {
    expect(findSlashToken('hello', 5, [])).toBeNull();
    expect(findSlashToken('hello world', 8, [])).toBeNull();
    expect(findSlashToken('https://x', 9, [])).toBeNull();
  });

  it('suppresses complete pills (caret inside or at end)', () => {
    const text = '/alpha-skill';
    const tokens = findSkillTokens(text, skills, []);
    expect(findSlashToken(text, 12, tokens)).toBeNull();
    expect(findSlashToken(text, 6, tokens)).toBeNull();
    expect(findSlashToken(text, 0, tokens)).toBeNull();
  });

  it('still triggers on partial names that are not pills yet', () => {
    const text = '/alpha-sk';
    expect(findSlashToken(text, 9, findSkillTokens(text, skills, []))).toEqual({ from: 0, to: 9, filter: 'alpha-sk' });
  });
});
