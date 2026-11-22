import { compactTabText, findTabReferences, type TabReference } from '@/lib/agent/tab-references';
import { attachPillPreview, attachTabPreview, TAB_PILL_LAYOUT } from './tab-preview';

/**
 * ComposerEditor — the chat composer's rich-text input (CodeMirror 6).
 *
 * The doc is plain text; installed-Skill references (`/name`) are rendered as
 * atomic inline pills via replace decorations, so a Skill sits in the text
 * flow exactly where the user typed it (issue: inline Skills). The pending
 * slash Prompt is a widget at position 0 — same "mark before the text" model
 * as before, but now it scrolls and wraps with the content naturally.
 *
 * CodeMirror owns caret / IME / undo; ChatInput keeps owning the string state
 * and all send / menu / history logic through the imperative handle below.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, Compartment, EditorState, Prec, RangeSet, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder, type DecorationSet, type PluginValue, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import { findSkillTokens, type SkillNameRef } from '@/lib/ai-config/skill-tokens';
import { SKILL_PILL_CLASS, SKILL_PILL_ICON_SVG } from '@/components/chat/SkillPill';
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
    span.append(icon, document.createTextNode(this.name));
    if (this.description?.trim()) this.detach = attachPillPreview(span, this.description);
    return span;
  }
  override destroy() { this.detach?.(); }
  override ignoreEvent(event: Event) { return event.target instanceof Element && !!event.target.closest('button'); }
}

class SlashPromptWidget extends WidgetType {
  constructor(readonly name: string) { super(); }
  override eq(other: SlashPromptWidget) { return other.name === this.name; }
  override toDOM() {
    const span = document.createElement('span');
    span.className = 'mr-1.5 rounded-md bg-primary/10 px-1.5 font-mono text-primary';
    span.textContent = `/${this.name}`;
    return span;
  }
  override ignoreEvent() { return false; }
}

class TabPillWidget extends WidgetType {
  private detach?: () => void;
  constructor(readonly reference: TabReference, readonly failure?: string) { super(); }
  override eq(other: TabPillWidget) {
    return other.reference.id === this.reference.id && other.reference.title === this.reference.title && other.failure === this.failure;
  }
  override toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'group rounded-md bg-primary/10 px-1.5 ' + TAB_PILL_LAYOUT + (this.failure ? ' text-destructive' : ' text-primary');
    span.dataset.tabReference = 'true';
    span.setAttribute('aria-label', [this.reference.title, this.failure].filter(Boolean).join(' · '));
    const icon = document.createElement('span');
    icon.className = 'relative mr-1 inline-block size-3.5 align-[-2px]';
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
    const label = document.createTextNode(compactTabText(this.reference.title, 28) + (this.failure ? ' · ' + this.failure : ''));
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
  tabFailures?: Readonly<Record<string, string>>;
  skills: readonly ComposerSkill[];
  promptNames: readonly string[];
  slashPromptName: string | null;
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
  const ranges = [...pills];
  if (cfg.slashPromptName) {
    ranges.push(Decoration.widget({ widget: new SlashPromptWidget(cfg.slashPromptName), side: -1 }).range(0));
  }
  return { decorations: Decoration.set(ranges, true), atomic: Decoration.set(pills, true) };
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
  tabFailures?: Readonly<Record<string, string>>;
  value: string;
  /** doc / caret updates; `userTyped` false for programmatic whole-doc writes. */
  onUpdate: (text: string, caret: number, userTyped: boolean) => void;
  skills: readonly ComposerSkill[];
  promptNames: readonly string[];
  slashPromptName: string | null;
  placeholder: string;
  disabled?: boolean;
  /** Return true when the key was consumed (send / menu nav / history…). */
  onKeyDown: (e: KeyboardEvent) => boolean;
  onPasteImages?: (e: ClipboardEvent) => void;
  onDropFiles?: (files: File[]) => void;
  className?: string;
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor(
  { value, onUpdate, skills, promptNames, slashPromptName, placeholder, disabled, onKeyDown, onPasteImages, onDropFiles, className, tabFailures },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef({ onUpdate, onKeyDown, onPasteImages, onDropFiles });
  propsRef.current = { onUpdate, onKeyDown, onPasteImages, onDropFiles };
  const cfgRef = useRef<PillConfig>({ skills, promptNames, slashPromptName, tabFailures, version: 0 });
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
      // 只有 pill（replace 装饰）是原子的；提示词标记是一个点，不参与。
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
          if (view && text) view.dispatch(view.state.replaceSelection(text));
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
    cfgRef.current = { skills, promptNames, slashPromptName, tabFailures, version: cfgRef.current.version + 1 };
    viewRef.current?.dispatch({});
  }, [skills, promptNames, slashPromptName, tabFailures]);

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
