import { Box } from 'lucide-react';

/** Shared visual for inline Skill references (composer widget + message bubble). */
export const SKILL_PILL_CLASS =
  'chat-inline-pill bg-info/10 text-info';

/** Lucide `box` icon markup for non-React contexts (CodeMirror widget DOM). */
export const SKILL_PILL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

export function SkillPill({ name, title }: { name: string; title?: string }) {
  return (
    <span className={SKILL_PILL_CLASS} title={title}>
      <Box className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}
