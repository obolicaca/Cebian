import type { ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { COMPOSER_PREVIEW_CLASS } from './tab-preview';

export function ComposerToolTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="top" align="start" sideOffset={6} avoidCollisions={false}
          className={`${COMPOSER_PREVIEW_CLASS} w-fit max-w-60 break-words`}>
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
}
