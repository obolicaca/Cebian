import { t } from '@/lib/i18n';
import type { InlineAttachment } from '@/lib/agent/attachment-tokens';
import { compactTabText } from '@/lib/agent/tab-references';
import { showDialog } from '@/lib/ui/dialog';
import { attachPillPreview } from './tab-preview';

export const ATTACHMENT_LABEL_CLASS = 'min-w-0 max-w-[12ch] truncate';

export function attachmentPillClass(type: InlineAttachment['type']) {
  return 'chat-inline-pill'
    + (type === 'image' ? ' bg-purple-500/10 text-purple-500 cursor-pointer' : ' bg-success/10 text-success');
}

export function attachmentName(att: InlineAttachment) {
  return att.name || t(att.type === 'image' && att.source === 'screenshot' ? 'chat.attachments.screenshot' : 'chat.attachments.image');
}

export function imageAttachmentSrc(att: Extract<InlineAttachment, { type: 'image' }>) {
  return `data:${att.mimeType};base64,${att.data}`;
}

export function previewImageAttachment(att: Extract<InlineAttachment, { type: 'image' }>) {
  showDialog('image-preview', { src: imageAttachmentSrc(att), alt: attachmentName(att) });
}

export function attachAttachmentPreview(anchor: HTMLElement, name: string, content = '') {
  if (content.trim() && /\.(?:md|markdown)$/i.test(name)) {
    return attachPillPreview(anchor, content, undefined, undefined, 'full');
  }
  const preview = compactTabText(content.slice(0, 600), 280);
  return attachPillPreview(anchor, preview, name);
}
