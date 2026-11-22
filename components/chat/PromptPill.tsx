import { FileText } from 'lucide-react';

/** Shared visual for inline Prompt references (composer widget + previews). */
export const PROMPT_PILL_CLASS =
  'chat-inline-pill bg-success/10 font-medium text-success';

/** Lucide `file-text` icon markup for non-React contexts (CodeMirror widget DOM). */
export const PROMPT_PILL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

export function PromptPill({ name, title }: { name: string; title?: string }) {
  return (
    <span className={PROMPT_PILL_CLASS} title={title}>
      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}