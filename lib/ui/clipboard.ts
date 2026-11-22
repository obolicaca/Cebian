/**
 * Unified clipboard access.
 *
 * All Cebian source must use this helper instead of calling
 * `navigator.clipboard.*` directly. Reasons:
 *   - Single fallback path (legacy `execCommand('copy')`) for the rare cases
 *     when the side panel loses focus and the modern API rejects.
 *   - Consistent toast feedback so callers don't have to re-implement it.
 *   - Easier to swap implementations later (e.g. background-bridged copy for
 *     content scripts).
 *
 * Never log the `text` argument: clipboard data may include OAuth codes or
 * API keys.
 */

import type { InlineAttachment } from '@/lib/agent/attachment-tokens';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

const CHAT_REFERENCES_FORMAT = 'web application/x-cebian-chat-references';

export interface CopiedChatReferences {
  promptNames?: readonly string[];
  quotedText?: string;
  attachments?: Record<string, InlineAttachment>;
}

export async function readCopiedChatReferences(text: string): Promise<CopiedChatReferences> {
  try {
    const items = await navigator.clipboard.read();
    const item = items.find(({ types }) => types.includes(CHAT_REFERENCES_FORMAT) && types.includes('text/plain'));
    const normalize = (value: string) => value.replace(/\r\n/g, '\n');
    if (!item || normalize(await (await item.getType('text/plain')).text()) !== normalize(text)) return {};
    const data = JSON.parse(await (await item.getType(CHAT_REFERENCES_FORMAT)).text());
    return {
      promptNames: Array.isArray(data?.promptNames)
        ? data.promptNames.filter((name: unknown) => typeof name === 'string') : undefined,
      attachments: data?.attachments && typeof data.attachments === 'object' ? data.attachments : undefined,
      quotedText: typeof data?.quotedText === 'string' ? normalize(data.quotedText) : undefined,
    };
  } catch {
    return {};
  }
}

interface CopyOptions {
  references?: CopiedChatReferences;
  /** Suppress success/failure toasts; caller handles its own feedback. */
  silent?: boolean;
}

export async function copyText(text: string, opts: CopyOptions = {}): Promise<boolean> {
  const ok = await tryCopy(text, opts.references);
  if (!opts.silent) {
    if (ok) toast.success(t('common.copied'));
    else toast.error(t('common.copyFailed'));
  }
  return ok;
}

export async function readText(): Promise<string> {
  // Modern API — requires `clipboardRead` permission and a focused document.
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch (err) {
    console.warn('[clipboard] readText (async API) failed, falling back to execCommand:', err);
  }
  // Legacy fallback: hidden textarea + execCommand('paste'). Works in some
  // Chromium builds even when the async API rejects. Must NOT be readonly —
  // execCommand('paste') is a no-op on readonly fields.
  const el = document.createElement('textarea');
  el.style.position = 'fixed';
  el.style.top = '-9999px';
  el.style.opacity = '0';
  document.body.appendChild(el);
  try {
    el.focus();
    const ok = document.execCommand('paste');
    return ok ? el.value : '';
  } catch (err) {
    console.warn('[clipboard] readText (execCommand) failed:', err);
    return '';
  } finally {
    el.remove();
  }
}

async function tryCopy(text: string, references?: CopiedChatReferences): Promise<boolean> {
  if (references?.promptNames?.length || references?.quotedText) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        [CHAT_REFERENCES_FORMAT]: new Blob([JSON.stringify(references)], { type: 'application/x-cebian-chat-references' }),
      })]);
      return true;
    } catch {
      // Clipboard implementations without web custom formats still receive plain text.
    }
  }
  // Modern API — works in secure contexts when the document is focused.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Legacy fallback: hidden textarea + execCommand('copy').
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
