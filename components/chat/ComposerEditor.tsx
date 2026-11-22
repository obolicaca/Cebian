import { attachmentToken, describeAttachmentTokens, findAttachmentTokens, type InlineAttachment } from '@/lib/agent/attachment-tokens';
import { ATTACHMENT_LABEL_CLASS, attachmentName, attachmentPillClass, attachAttachmentPreview, imageAttachmentSrc, previewImageAttachment } from './attachment-pill';
import { compactTabText, describeTabReferences, findTabReferences, tabReferenceToken, type TabReference } from '@/lib/agent/tab-references';
import { displayQuotedText, findQuoteTokens } from '@/lib/agent/quote-tokens';
import { readCopiedChatReferences } from '@/lib/ui/clipboard';
import { attachPillPreview, attachTabPreview, QUOTE_PILL_STYLE, TAB_PILL_LAYOUT } from './tab-preview';

/**
 * ComposerEditor — the chat composer's rich-text input (CodeMirror 6).
 *
 * The doc is plain text; installed-Skill references (`/name`) are rendered as
 * atomic inline pills via replace decorations, so a Skill sits in the text
 * flow exactly where the user typed it (issue: inline Skills). The picked
 * slash Prompt is an inline pill too: its `/name` token lives in the doc at
 * the insertion point, while the expanded body stays in ChatInput state.
 *
 * CodeMirror owns caret / IME / undo; ChatInput keeps owning the string state
 * and all send / menu / history logic through the imperative handle below.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, Compartment, EditorState, Prec, RangeSet, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder, type DecorationSet, type PluginValue, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import { findPromptTokens, findSkillTokens, type SkillNameRef } from '@/lib/ai-config/skill-tokens';
import { SKILL_PILL_CLASS, SKILL_PILL_ICON_SVG } from '@/components/chat/SkillPill';
import { PROMPT_PILL_CLASS, PROMPT_PILL_ICON_SVG } from '@/components/chat/PromptPill';
import type { SlashPrompt } from '@/lib/ai-config/slash-prompt';
import { t } from '@/lib/i18n';

/** Marks programmatic whole-doc writes so they don't look like user typing. */
const externalSync = Annotation.define<boolean>();

function pillRemoveButton(label: string, onRemove: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'absolute inset-0 grid place-items-center rounded-sm opacity-0 group-hover:opacity-100 focus:opacity-100';
  button.setAttribute('aria-label', label);
  button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', onRemove);
  return button;
}

function removePillRange(view: EditorView, from: number, end: number) {
  if (view.state.readOnly) return;
  const to = view.state.sliceDoc(end, end + 1) === ' ' ? end + 1 : end;
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: 'delete.selection' });
  view.focus();
}

class SkillPillWidget extends WidgetType {
  private detach?: () => void;
  constructor(readonly name: string, readonly description?: string) { super(); }
  override eq(other: SkillPillWidget) { return other.name === this.name && other.description === this.description; }
  override toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = SKILL_PILL_CLASS + ' group';
    span.setAttribute('aria-label', this.name);
    const icon = document.createElement('span');
    icon.className = 'relative size-3.5 shrink-0';
    const box = document.createElement('span');
    box.className = 'absolute inset-0 group-hover:invisible group-focus-within:invisible';
    box.innerHTML = SKILL_PILL_ICON_SVG;
    icon.append(box, pillRemoveButton(t('chat.composer.removeSkillReference', [this.name]), () => {
      const from = view.posAtDOM(span);
      const to = from + this.name.length + 1;
      if (view.state.sliceDoc(from, to) === '/' + this.name) removePillRange(view, from, to);
    }));
    const label = document.createElement('span');
    label.className = 'min-w-0 truncate';
    label.textContent = this.name;
    span.append(icon, label);
    if (this.description?.trim()) this.detach = attachPillPreview(span, this.description);
    return span;
  }
  override destroy() { this.detach?.(); }
  override ignoreEvent(event: Event) { return event.target instanceof Element && !!event.target.closest('button'); }
}

class PromptPillWidget extends WidgetType {
  private detach?: () => void;
  constructor(readonly name: string, readonly preview?: string) { super(); }
  override eq(other: PromptPillWidget) { return other.name === this.name && other.preview === this.preview; }
  override toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = PROMPT_PILL_CLASS + ' group';
    span.setAttribute('aria-label', this.name);
    span.dataset.promptPill = 'true';
    const icon = document.createElement('span');
    icon.className = 'relative size-3.5 shrink-0';
    const file = document.createElement('span');
    file.className = 'absolute inset-0 group-hover:invisible group-focus-within:invisible';
    file.innerHTML = PROMPT_PILL_ICON_SVG;
    icon.append(file, pillRemoveButton(t('chat.composer.removePromptReference', [this.name]), () => {
      const from = view.posAtDOM(span);
      const to = from + this.name.length + 1;
      if (view.state.sliceDoc(from, to) === '/' + this.name) removePillRange(view, from, to);
    }));
    const label = document.createElement('span');
    label.className = 'min-w-0 truncate';
    label.textContent = this.name;
    span.append(icon, label);
    if (this.preview?.trim()) this.detach = attachPillPreview(span, this.preview);
    return span;
  }
  override destroy() { this.detach?.(); }
  override ignoreEvent(event: Event) { return event.target instanceof Element && !!event.target.closest('button'); }
}

class AttachmentPillWidget extends WidgetType {
  private detach?: () => void;
  constructor(readonly id: string, readonly attachment?: InlineAttachment) { super(); }
  override eq(other: AttachmentPillWidget) { return other.id === this.id && other.attachment === this.attachment; }
  override toDOM(view: EditorView) {
    const pill = document.createElement('span');
    const att = this.attachment;
    if (!att) return pill;
    pill.dataset.attachmentPill = att.type;
    const name = attachmentName(att);
    pill.className = attachmentPillClass(att.type);
    const icon = document.createElement('span');
    icon.className = 'group relative size-3.5 shrink-0';
    const visual = document.createElement('span');
    visual.className = 'absolute inset-0 group-hover:invisible group-focus-within:invisible';
    const label = document.createElement(att.type === 'image' ? 'button' : 'span');
    label.className = ATTACHMENT_LABEL_CLASS;
    label.textContent = name;
    if (att.type === 'image') {
      const img = document.createElement('img');
      img.src = imageAttachmentSrc(att);
      img.alt = '';
      img.className = 'size-full rounded-sm object-cover';
      visual.append(img);
      pill.addEventListener('mousedown', (event) => event.preventDefault());
      pill.addEventListener('click', (event) => {
        if (!icon.contains(event.target as Node)) previewImageAttachment(att);
      });
      (label as HTMLButtonElement).type = 'button';
    } else {
      visual.innerHTML = PROMPT_PILL_ICON_SVG;
    }
    icon.append(visual, pillRemoveButton(t('common.delete') + ' ' + name, () => {
      const from = view.posAtDOM(pill);
      const token = attachmentToken(this.id);
      if (view.state.sliceDoc(from, from + token.length) === token) removePillRange(view, from, from + token.length);
    }));
    pill.append(icon, label);
    this.detach = attachAttachmentPreview(pill, name, att.type === 'file' ? att.content : undefined);
    return pill;
  }
  override destroy() { this.detach?.(); }
  override ignoreEvent(event: Event) { return event.type !== 'keydown'; }
}

class QuotePillWidget extends WidgetType {
  private detach?: () => void;
  constructor(readonly quote: string, readonly title?: string) { super(); }
  override eq(other: QuotePillWidget) { return other.quote === this.quote && other.title === this.title; }
  override toDOM(view: EditorView) {
    const pill = document.createElement('span');
    pill.className = `group ${QUOTE_PILL_STYLE} ${TAB_PILL_LAYOUT}`;
    pill.dataset.quotePill = 'true';
    if (this.title !== undefined) pill.dataset.historyReference = 'true';
    const icon = document.createElement('span');
    icon.className = 'relative size-3.5 shrink-0';
    const glyph = document.createElement('span');
    glyph.className = 'absolute inset-0 grid place-items-center group-hover:invisible group-focus-within:invisible';
    glyph.textContent = this.title === undefined ? '❝' : '◷';
    icon.append(glyph, pillRemoveButton(t('chat.removeQuote'), () => {
      const from = view.posAtDOM(pill);
      const token = findQuoteTokens(view.state.doc.toString()).find((item) => item.from === from);
      if (token) removePillRange(view, token.from, token.to);
    }));
    const label = document.createElement('span');
    label.className = 'min-w-0 truncate';
    label.textContent = compactTabText(this.title ?? this.quote, 28);
    pill.append(icon, label);
    this.detach = attachPillPreview(pill, this.title === undefined ? this.quote : compactTabText(this.quote, 280), undefined, undefined, this.title === undefined);
    return pill;
  }
  override destroy() { this.detach?.(); }
}

class TabPillWidget extends WidgetType {
  private detach?: () => void;
  constructor(readonly reference: TabReference, readonly failure?: string) { super(); }
  override eq(other: TabPillWidget) {
    return other.reference.id === this.reference.id && other.reference.title === this.reference.title && other.failure === this.failure;
  }
  override toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'group bg-primary/10 ' + TAB_PILL_LAYOUT + (this.failure ? ' text-destructive' : ' text-primary');
    span.dataset.tabReference = 'true';
    span.setAttribute('aria-label', [this.reference.title, this.failure].filter(Boolean).join(' · '));
    const icon = document.createElement('span');
    icon.className = 'relative size-3.5 shrink-0';
    icon.setAttribute('aria-hidden', 'true');
    const globe = document.createElement('span');
    globe.className = 'absolute inset-0 group-hover:invisible group-focus-within:invisible';
    globe.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><ellipse cx="12" cy="12" rx="4" ry="10"/></svg>';
    icon.append(globe);
    if (chrome.tabs?.get) {
      void chrome.tabs.get(this.reference.tabId).then((tab) => {
        if (tab.url !== this.reference.url || !tab.favIconUrl) return;
        const image = document.createElement('img');
        image.className = globe.className + ' size-3.5 rounded-sm object-contain';
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.onload = () => globe.replaceWith(image);
        image.src = tab.favIconUrl;
      }).catch(() => {});
    }
    const remove = pillRemoveButton(t('chat.composer.removeTabReference', [this.reference.title]), () => {
      const token = findTabReferences(view.state.doc.toString()).find(({ ref }) => ref.id === this.reference.id);
      if (token) removePillRange(view, token.from, token.to);
    });
    const label = document.createElement('span');
    label.className = 'min-w-0 truncate';
    label.textContent = compactTabText(this.reference.title, 28) + (this.failure ? ' · ' + this.failure : '');
    span.append(icon, label);
    icon.removeAttribute('aria-hidden');
    icon.append(remove);
    this.detach = attachTabPreview(span, this.reference);
    return span;
  }
  override destroy() { this.detach?.(); }
}

type ComposerSkill = SkillNameRef & { description?: string };

interface PillConfig {
  inlineAttachments: ReadonlyMap<string, InlineAttachment>;
  tabFailures?: Readonly<Record<string, string>>;
  skills: readonly ComposerSkill[];
  promptNames: readonly string[];
  slashPrompts: readonly SlashPrompt[];
  version: number;
}

function buildDecorations(state: EditorState, cfg: PillConfig): { decorations: DecorationSet; atomic: DecorationSet } {
  const tokens = findSkillTokens(state.doc.toString(), cfg.skills, cfg.promptNames);
  const pills = tokens.map((token) =>
    Decoration.replace({
      widget: new SkillPillWidget(token.name, cfg.skills.find((skill) => skill.filePath === token.filePath)?.description),
      inclusiveStart: false,
      inclusiveEnd: false,
    }).range(token.from, token.to));
  for (const token of findTabReferences(state.doc.toString())) {
    pills.push(Decoration.replace({ widget: new TabPillWidget(token.ref, cfg.tabFailures?.[token.ref.id]) }).range(token.from, token.to));
  }
  for (const token of findAttachmentTokens(state.doc.toString())) {
    const widget = new AttachmentPillWidget(token.id, cfg.inlineAttachments.get(token.id));
    pills.push(Decoration.replace({ widget }).range(token.from, token.to));
  }
  for (const token of findQuoteTokens(state.doc.toString())) {
    pills.push(Decoration.replace({ widget: new QuotePillWidget(token.quote, token.title) }).range(token.from, token.to));
  }
  if (cfg.slashPrompts.length) {
    for (const token of findPromptTokens(state.doc.toString(), cfg.slashPrompts.map((p) => p.name))) {
      pills.push(Decoration.replace({
        widget: new PromptPillWidget(token.name, cfg.slashPrompts.find((p) => p.name === token.name)?.body),
        inclusiveStart: false,
        inclusiveEnd: false,
      }).range(token.from, token.to));
    }
  }
  return { decorations: Decoration.set(pills, true), atomic: Decoration.set(pills, true) };
}

/** Replace decorations hide the text; atomicRanges makes cursor / backspace
 *  treat each pill as one indivisible unit. */
class PillPlugin implements PluginValue {
  decorations: DecorationSet;
  atomic: DecorationSet;
  private version: number;
  constructor(view: EditorView, private cfg: () => PillConfig) {
    this.version = cfg().version;
    ({ decorations: this.decorations, atomic: this.atomic } = buildDecorations(view.state, cfg()));
  }
  update(update: ViewUpdate) {
    const cfg = this.cfg();
    if (update.docChanged || cfg.version !== this.version) {
      this.version = cfg.version;
      ({ decorations: this.decorations, atomic: this.atomic } = buildDecorations(update.state, cfg));
    }
  }
}

export interface ComposerEditorHandle {
  focus(): void;
  getValue(): string;
  getSelection(): { start: number; end: number };
  setSelectionRange(start: number, end: number): void;
  replaceRange(from: number, to: number, insert: string): void;
  getScrollTop(): number;
  setScrollTop(top: number): void;
}

interface ComposerEditorProps {
  inlineAttachments: ReadonlyMap<string, InlineAttachment>;
  tabFailures?: Readonly<Record<string, string>>;
  value: string;
  /** doc / caret updates; `userTyped` false for programmatic whole-doc writes. */
  onUpdate: (text: string, caret: number, userTyped: boolean) => void;
  skills: readonly ComposerSkill[];
  promptNames: readonly string[];
  slashPrompts: readonly SlashPrompt[];
  placeholder: string;
  disabled?: boolean;
  /** Return true when the key was consumed (send / menu nav / history…). */
  onKeyDown: (e: KeyboardEvent) => boolean;
  onPasteAttachments?: (text: string, attachments: Record<string, InlineAttachment>) => string;
  onPasteText?: (text: string, promptNames: readonly string[]) => void;
  onPasteImages?: (e: ClipboardEvent) => void;
  onDropFiles?: (files: File[]) => void;
  className?: string;
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor(
  { value, onUpdate, inlineAttachments, skills, promptNames, slashPrompts, placeholder, disabled, onKeyDown, onPasteAttachments, onPasteText, onPasteImages, onDropFiles, className, tabFailures },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef({ onUpdate, onKeyDown, onPasteAttachments, onPasteText, onPasteImages, onDropFiles });
  propsRef.current = { onUpdate, onKeyDown, onPasteAttachments, onPasteText, onPasteImages, onDropFiles };
  const cfgRef = useRef<PillConfig>({ inlineAttachments, skills, promptNames, slashPrompts, tabFailures, version: 0 });
  const editableComp = useRef(new Compartment()).current;

  useEffect(() => {
    if (!containerRef.current) return;
    const pillPlugin = ViewPlugin.define((view) => new PillPlugin(view, () => cfgRef.current), {
      decorations: (plugin) => plugin.decorations,
    });
    const extensions: Extension[] = [
      history(),
      keymap.of([
        { key: 'Shift-Enter', run: insertNewline },
        { key: 'Mod-Enter', run: () => true },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      cmPlaceholder(placeholder),
      pillPlugin,
      // pill（replace 装饰，含 Skill / Prompt / 标签页 / 引用）都是原子的。
      EditorView.atomicRanges.of((view) => view.plugin(pillPlugin)?.atomic ?? RangeSet.empty),
      editableComp.of(EditorView.editable.of(!disabled)),
      EditorView.theme({
        '&': { backgroundColor: 'transparent', fontSize: 'inherit' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { overflowY: 'auto', minHeight: '3.25rem', maxHeight: '9.375rem', fontFamily: 'inherit', lineHeight: '1.625' },
        '.cm-content': { padding: '0.5rem 0.75rem', fontFamily: 'inherit' },
        '.cm-line': { padding: '0' },
        '.cm-placeholder': { color: 'var(--color-muted-foreground, #888)', opacity: '0.5' },
      }),
      EditorView.contentAttributes.of({ role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder }),
      Prec.highest(EditorView.domEventHandlers({
        keydown: (e) => propsRef.current.onKeyDown(e),
        paste: (e) => {
          e.preventDefault();
          const text = e.clipboardData?.getData('text/plain') ?? '';
          const view = viewRef.current;
          if (view && text) {
            const plain = text.replace(/\r\n/g, '\n');
            const from = view.state.selection.main.from;
            view.dispatch(view.state.replaceSelection(plain));
            const pastedDoc = view.state.doc;
            {
              void readCopiedChatReferences(plain).then(({ promptNames, quotedText, attachments }) => {
                if (viewRef.current !== view || view.state.doc !== pastedDoc || view.state.readOnly) return;
                const described = quotedText && describeAttachmentTokens(quotedText, new Map(
                  Object.entries(attachments ?? {}).map(([id, att]) => [id, att?.name ?? '']),
                ));
                const restored = quotedText && described && displayQuotedText(describeTabReferences(described)) === plain
                  ? (attachments ? propsRef.current.onPasteAttachments?.(quotedText, attachments) ?? plain : quotedText)
                  : plain;
                // Each pasted occurrence owns its remove action and send-time status.
                const rich = restored === plain ? plain : findTabReferences(restored).reverse().reduce(
                  (text, { ref: { tabId, title, url }, from, to }) =>
                    text.slice(0, from) + tabReferenceToken({ id: crypto.randomUUID(), tabId, title, url }) + text.slice(to),
                  restored,
                );
                if (rich !== plain) {
                  view.dispatch({ changes: { from, to: from + plain.length, insert: rich } });
                }
                if (promptNames?.length) propsRef.current.onPasteText?.(rich, promptNames);
              });
            }
          }
          propsRef.current.onPasteImages?.(e);
          return true;
        },
        drop: (e) => {
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length === 0) return false;
          e.preventDefault();
          propsRef.current.onDropFiles?.(files);
          return true;
        },
      })),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged && !update.selectionSet) return;
        const external = update.transactions.some((tr) => tr.annotation(externalSync) === true);
        propsRef.current.onUpdate(
          update.state.doc.toString(),
          update.state.selection.main.head,
          update.docChanged && !external,
        );
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External whole-doc writes (history / speech / fill / queue / clear).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: value.length },
      annotations: externalSync.of(true),
    });
  }, [value]);

  // Pill config changes (installed index loaded, prompt picked, …).
  useEffect(() => {
    cfgRef.current = { inlineAttachments, skills, promptNames, slashPrompts, tabFailures, version: cfgRef.current.version + 1 };
    viewRef.current?.dispatch({});
  }, [inlineAttachments, skills, promptNames, slashPrompts, tabFailures]);

  const placedAttachments = useRef(new Set<string>());
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const tokens = findAttachmentTokens(view.state.doc.toString());
    const additions = [...inlineAttachments.keys()].filter((id) => !placedAttachments.current.has(id) && !tokens.some((token) => token.id === id));
    placedAttachments.current = new Set(inlineAttachments.keys());
    const stale = tokens.filter(({ id }) => !inlineAttachments.has(id));
    if (stale.length) {
      view.dispatch({ changes: stale.map(({ from, to }) => ({
        from, to: view.state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to,
      })), annotations: Transaction.addToHistory.of(false) });
    }
    if (!additions.length) return;
    const at = view.state.selection.main.to;
    const leading = at > 0 && !/\s/.test(view.state.sliceDoc(at - 1, at)) ? ' ' : '';
    const insert = leading + additions.map(attachmentToken).join(' ') + ' ';
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
    view.focus();
  }, [inlineAttachments]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editableComp.reconfigure(EditorView.editable.of(!disabled)) });
  }, [disabled, editableComp]);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    getSelection: () => {
      const main = viewRef.current?.state.selection.main;
      return { start: main?.from ?? 0, end: main?.to ?? 0 };
    },
    setSelectionRange: (start, end) => {
      viewRef.current?.dispatch({ selection: { anchor: start, head: end } });
    },
    replaceRange: (from, to, insert) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
    },
    getScrollTop: () => viewRef.current?.scrollDOM.scrollTop ?? 0,
    setScrollTop: (top) => { if (viewRef.current) viewRef.current.scrollDOM.scrollTop = top; },
  }), []);

  return <div ref={containerRef} className={className} />;
});
