import { MAX_IMAGE_SIZE, MAX_TEXT_FILE_SIZE, planFileIntake, type ImageAttachment, type TextFileAttachment } from './attachments';

export type InlineAttachment = ImageAttachment | TextFileAttachment;

export function attachmentToken(id: string): string {
  return `⟦cebian-attachment:${id}⟧`;
}

export function findAttachmentTokens(text: string) {
  return Array.from(text.matchAll(/⟦cebian-attachment:([a-f0-9-]{36})⟧/g), (match) => ({
    id: match[1],
    from: match.index,
    to: match.index + match[0].length,
  }));
}

export function describeAttachmentTokens(text: string, names: ReadonlyMap<string, string>): string {
  return findAttachmentTokens(text).reverse().reduce((result, { id, from, to }) =>
    result.slice(0, from) + (names.get(id) ?? '') + result.slice(to), text);
}

export function validateCopiedAttachment(value: unknown, supportsImage: boolean): InlineAttachment | undefined {
  if (!value || typeof value !== 'object') return;
  const att = value as InlineAttachment;
  if (typeof att.name !== 'string' || !att.name || typeof att.mimeType !== 'string') return;
  if (att.type === 'image' && supportsImage && typeof att.data === 'string'
    && att.data.length <= Math.ceil(MAX_IMAGE_SIZE / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(att.data)) {
    const file = new File([], att.name, { type: att.mimeType });
    if (planFileIntake([file], { remaining: 1, supportsImage }).accepted[0]?.kind === 'image') {
      return { type: 'image', name: att.name, mimeType: att.mimeType, data: att.data, source: 'paste' };
    }
  }
  if (att.type === 'file' && typeof att.content === 'string' && att.content.length <= MAX_TEXT_FILE_SIZE) {
    const file = new File([att.content], att.name, { type: att.mimeType });
    if (planFileIntake([file], { remaining: 1, supportsImage }).accepted[0]?.kind === 'text') {
      return { type: 'file', name: att.name, mimeType: att.mimeType, content: att.content, size: file.size };
    }
  }
}

export function stripAttachmentTokens(text: string): string {
  return text.replace(/⟦cebian-attachment:[a-f0-9-]{36}⟧ ?/g, '');
}
