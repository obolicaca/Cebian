import { ComposerToolTooltip } from './ComposerToolTooltip';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export function ComposerUploadButton({ disabled, onUpload }: { disabled: boolean; onUpload: () => void }) {
  const label = t('chat.composer.uploadFile');
  return (
    <ComposerToolTooltip label={label}>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={label}
        disabled={disabled} className="size-7" onClick={onUpload}>
        <Upload className="size-3.5" />
      </Button>
    </ComposerToolTooltip>
  );
}
