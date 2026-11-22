import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, History, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChatAppearance } from '@/hooks/useChatAppearance';
import { chatAppearanceStyle } from '@/lib/ui/chat-appearance';
import { useSessionList } from '@/hooks/useSessionList';
import { loadHistoryReference } from '@/lib/agent/history-reference';
import { t } from '@/lib/i18n';

const MENU_ITEM_CLASS = 'chat-menu-text flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

interface ComposerAddMenuProps {
  disabled: boolean;
  historyReferences: readonly { title: string; sessionId?: string }[];
  onUpload: () => void;
  onHistorySelect: (token: string) => boolean;
}

export function ComposerAddMenu({ disabled, historyReferences, onUpload, onHistorySelect }: ComposerAddMenuProps) {
  const appearance = useChatAppearance();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pending, setPending] = useState(false);
  const selection = useRef(0);
  const inserted = useRef(false);
  const { sessions, loading } = useSessionList(open && showHistory);
  useEffect(() => () => { selection.current++; }, []);
  const choices = sessions.filter((session) => session.messageCount > 0);

  const changeOpen = (next: boolean) => {
    selection.current++;
    setOpen(next);
    setShowHistory(false);
    setPending(false);
  };

  const chooseHistory = async (id: string) => {
    const seq = ++selection.current;
    setPending(true);
    try {
      const token = await loadHistoryReference(id);
      if (selection.current !== seq) return;
      if (!token) {
        toast.error(t('chat.composer.historyReferenceUnavailable'));
        return;
      }
      if (onHistorySelect(token)) {
        inserted.current = true;
        changeOpen(false);
      }
    } catch {
      if (selection.current === seq) toast.error(t('chat.composer.historyReferenceUnavailable'));
    } finally {
      if (selection.current === seq) setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('common.add')} title={t('common.add')} disabled={disabled} className="size-7">
          <Plus className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" style={appearance ? chatAppearanceStyle(appearance) : undefined}
        className="chat-menu-text max-w-[calc(100vw-2rem)] p-1.5" onCloseAutoFocus={(event) => {
        if (!inserted.current) return;
        inserted.current = false;
        event.preventDefault();
      }}>
        {showHistory ? (
          <>
            <button type="button" className={MENU_ITEM_CLASS + ' mb-1'} onClick={() => {
              selection.current++;
              setPending(false);
              setShowHistory(false);
            }}>
              <ArrowLeft className="size-4 shrink-0" />
              {t('common.history')}
            </button>
            <div className="max-h-56 overflow-y-auto">
              {loading && <p className="px-2 py-1 text-[0.85em] text-muted-foreground">{t('common.loading')}</p>}
              {!loading && !choices.length && <p className="px-2 py-1 text-[0.85em] text-muted-foreground">{t('common.empty.history')}</p>}
              {choices.map((session) => {
                const title = session.title.trim().slice(0, 512) || 'Chat';
                const referenced = historyReferences.some((ref) => ref.sessionId === session.id)
                  || (historyReferences.some((ref) => !ref.sessionId && ref.title === title)
                    && choices.filter((item) => (item.title.trim().slice(0, 512) || 'Chat') === title).length === 1);
                return (
                  <button key={session.id} type="button" className={MENU_ITEM_CLASS} title={session.title}
                    disabled={disabled || pending} onClick={() => void chooseHistory(session.id)}>
                    <History className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    {referenced && <Check aria-label={t('chat.composer.tabReferenced')} className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <button type="button" className={MENU_ITEM_CLASS} disabled={disabled} onClick={() => {
              changeOpen(false);
              onUpload();
            }}>
              <Upload className="size-4 shrink-0" />
              {t('chat.composer.uploadFile')}
            </button>
            <button type="button" className={MENU_ITEM_CLASS} disabled={disabled} onClick={() => setShowHistory(true)}>
              <History className="size-4 shrink-0" />
              {t('chat.composer.referenceHistory')}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
