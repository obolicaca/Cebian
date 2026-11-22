// UI-only snapshot stored ahead of the prompt envelope and removed at the model boundary.
export interface ComposerDisplay {
  text: string;
  attachments?: { id: string; type: 'file' | 'image'; name: string }[];
  references: { kind: 'skill' | 'prompt'; name: string; from: number; to: number }[];
}

const DISPLAY_PREFIX = /^<composer-display>([^\n]*)<\/composer-display>\n\n/;

export function wrapComposerDisplay(display?: ComposerDisplay): string {
  if (!display) return '';
  const json = JSON.stringify(display).replace(/</g, '\\u003c');
  return `<composer-display>${json}</composer-display>\n\n`;
}

export function readComposerDisplay(raw: string): ComposerDisplay | undefined {
  const match = raw.match(DISPLAY_PREFIX);
  if (!match) return;
  try {
    const display = JSON.parse(match[1]) as ComposerDisplay | null;
    if (typeof display?.text !== 'string' || !Array.isArray(display.references)) return;
    if (display.attachments !== undefined && (!Array.isArray(display.attachments)
      || !display.attachments.every((att) => att && (att.type === 'file' || att.type === 'image')
        && typeof att.id === 'string' && typeof att.name === 'string'))) return;
    const { text, references } = display;
    if (!references.every((ref) => ref && (ref.kind === 'skill' || ref.kind === 'prompt')
      && typeof ref.name === 'string' && Number.isInteger(ref.from) && Number.isInteger(ref.to)
      && ref.from >= 0 && ref.to <= text.length && text.slice(ref.from, ref.to) === '/' + ref.name)) return;
    return display;
  } catch {
    return undefined;
  }
}

export function stripComposerDisplay(text: string): string {
  return text.startsWith('<composer-display>') ? text.replace(DISPLAY_PREFIX, '') : text;
}
