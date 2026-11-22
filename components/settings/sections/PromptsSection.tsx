import { CEBIAN_PROMPTS_DIR } from '@/lib/persistence/vfs-paths';
import { t } from '@/lib/i18n';
import { MarkdownFileManager } from './MarkdownFileManager';

const PROMPT_TEMPLATE = () => `---
name: new-prompt
description: ""
---

${t('settings.prompts.newBody')}
`;

export function PromptsSection() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
        <h2 className="text-base font-semibold">{t('settings.prompts.title')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {(() => {
            // settings.prompts.hint embeds $1 where the trigger char appears,
            // so we can render <code>/</code> in the middle of translated text.
            // Use a multi-char ASCII sentinel — single control chars (\u0000)
            // are stripped by chrome.i18n.getMessage substitution.
            const SENTINEL = '__CEBIAN_TRIGGER__';
            const parts = t('settings.prompts.hint', [SENTINEL]).split(SENTINEL);
            return <>{parts[0]}<code className="text-[11px]">/</code>{parts[1] ?? ''}</>;
          })()}
        </p>
      </div>
      <MarkdownFileManager section="prompts" directory={CEBIAN_PROMPTS_DIR} newFileTemplate={PROMPT_TEMPLATE()} />
    </div>
  );
}
