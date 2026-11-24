import { ComposerUploadButton } from './ComposerUploadButton';
import type { ComposerDisplay } from '@/lib/agent/composer-display';
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react';
import { AtSign, Box, Check, Globe, History, Send, Square, MousePointer2, Camera, Paperclip, Smartphone, Crosshair, FileText, X, Film, Network, ListPlus, CornerDownRight } from 'lucide-react';
import { attachmentName } from './attachment-pill';
import { attachmentToken, describeAttachmentTokens, findAttachmentTokens, stripAttachmentTokens, validateCopiedAttachment, type InlineAttachment } from '@/lib/agent/attachment-tokens';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ComposerToolTooltip } from './ComposerToolTooltip';
import { ModelSelector } from '@/components/chat/ModelSelector';
import { ThinkingLevelSelector } from '@/components/chat/ThinkingLevelSelector';
import { RecordButton } from '@/components/chat/RecordButton';
import { MicButton } from '@/components/chat/MicButton';
import { ContextUsageIndicator } from '@/components/chat/ContextUsageIndicator';
import { QueuedMessages } from '@/components/chat/QueuedMessages';
import { useSessionList } from '@/hooks/useSessionList';
import { loadHistoryReference } from '@/lib/agent/history-reference';
import { useStorageItem } from '@/hooks/useStorageItem';
import { providerCredentials, customProviders as customProvidersStorage, followUpDelivery, type FollowUpDelivery, type ThinkingLevel, type ModelIdentity } from '@/lib/persistence/storage';
import type { ContextUsage, QueuedPromptView } from '@/lib/ipc/protocol';
import { getSupportedThinkingLevels, clampThinkingLevel } from '@earendil-works/pi-ai';
import { resolveModel } from '@/lib/providers/resolve-model';
import { isUsableModel } from '@/lib/providers/usable-models';
import { startElementPicker, cancelElementPicker } from '@/lib/browser/element-picker';
import { scanPrompts, scanSkillIndex, type PromptMeta, type SkillMeta } from '@/lib/ai-config/scanner';
import { resolveSelectedSkills, type SelectedSkill } from '@/lib/ai-config/selected-skills';
import { findPromptTokens, findSkillTokens, findSlashToken, stripSkillTokens, tokensToSkills, type SlashToken } from '@/lib/ai-config/skill-tokens';
import { findQuoteTokens, quoteToken } from '@/lib/agent/quote-tokens';
import { ComposerEditor, type ComposerEditorHandle } from '@/components/chat/ComposerEditor';
import { replaceTemplateVars } from '@/lib/ai-config/template';
import { gatherTemplateVars } from '@/lib/ai-config/template-vars-sidepanel';
import type { SlashPrompt } from '@/lib/ai-config/slash-prompt';
import { vfs } from '@/lib/persistence/vfs';
import { parseFrontmatter } from '@/lib/content/frontmatter';
import { CEBIAN_PROMPTS_DIR } from '@/lib/persistence/vfs-paths';
import { MAX_ATTACHMENT_COUNT, RECORDING_MIME, type Attachment } from '@/lib/agent/attachments';
import { useRecorder } from '@/hooks/useRecorder';
import { useComposerAttachments } from '@/hooks/useComposerAttachments';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { appendTranscript, cleanTranscript } from '@/lib/speech/transcript';
import { openPermissionPage, openPermissionSettings, queryPermission } from '@/lib/ui/user-permission';
import { useMobileEmulation } from '@/hooks/useMobileEmulation';
import { downloadFile, formatCompactCount, isApplePlatform } from '@/lib/utils';
import { recordingMetaText, recordingTitle } from '@/components/chat/recording-meta';
import { t } from '@/lib/i18n';
import { findTabReferences, isReferenceableTab, splitTabReferenceContext, tabLink, tabReferenceToken } from '@/lib/agent/tab-references';
import type { PromptDispatchResult, QueueTakeResult } from '@/hooks/useBackgroundAgent';

interface ChatInputProps {
  onSend: (
    message: string,
    attachments: Attachment[] | undefined,
    expectedSessionId: string | null,
    slashPrompts: SlashPrompt[] | undefined,
    /** 任务运行中发送时的交付方式（排队 / 插话）；空闲时为 undefined（普通发送）。 */
    delivery: FollowUpDelivery | undefined,
    selectedSkills: SelectedSkill[] | undefined,
    composerDisplay?: ComposerDisplay,
  ) => Promise<PromptDispatchResult>;
  onOpenSettings?: (section?: string) => void;
  isAgentRunning?: boolean;
  onCancel?: () => void;
  /** User-message texts already sent in this session, oldest first. */
  userHistory?: string[];
  /** Conversation id; changing it resets history navigation state. */
  sessionId?: string | null;
  /** 本轮选中的模型 / 思考档（受控）。由 ChatPage 持有：新对话从全局种子 seed、
   *  已有会话从会话行 seed；切换走 onModelChange / onThinkingChange。 */
  model: ModelIdentity | null;
  thinkingLevel: ThinkingLevel;
  onModelChange: (model: ModelIdentity) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  /** 当前上下文占用；`null`（还没收到后台快照）时不渲染占用环。 */
  contextUsage: ContextUsage | null;
  /** 后台会话是否非空闲（回复 / 压缩中，含等待工具或授权裁决——`isAgentRunning` 在那时
   *  为 false，但后台仍不受理压缩）。用于置灰「立即压缩」。 */
  agentBusy?: boolean;
  /** 手动压缩上下文（issue #85）。 */
  onCompact?: () => void;
  /** 发送进行中（上锁到派发完成）的起止通知。聊天页据此决定拖放区此刻能不能接收文件。 */
  onDispatchingChange?: (dispatching: boolean) => void;
  /** 后台保管的排队 / 插话消息（issue #96），显示在输入框上方。 */
  queue?: QueuedPromptView[];
  queuePaused?: boolean;
  onRemoveQueued?: (id: string) => void;
  /** 取回一条排队消息的完整内容（后台同时移出队列）。 */
  onTakeQueued?: (id: string) => Promise<QueueTakeResult>;
  onSendQueuedNow?: (id: string) => void;
}

/** 暴露给父组件的 imperative handle：允许欢迎页等外部入口填入文本并聚焦输入框，
 *  同时仍由 ChatInput 持有 value 状态。 */
export interface ChatInputHandle {
  fill: (text: string) => void;
  insertQuote: (text: string) => boolean;
  /** 聊天页拖放区放下的文件；`folders` 是被排除的文件夹名，只用来提示。 */
  addFiles: (files: readonly File[], folders: readonly string[]) => void;
}

const MENU_SEARCH_CLASS =
  'chat-menu-text w-full rounded-md border border-border bg-transparent px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/40';

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, onOpenSettings, isAgentRunning, onCancel, userHistory, sessionId, model: currentModel, thinkingLevel: currentThinkingLevel, onModelChange, onThinkingChange, contextUsage, agentBusy, onCompact, onDispatchingChange, queue = [], queuePaused = false, onRemoveQueued, onTakeQueued, onSendQueuedNow },
  ref,
) {
  const [value, setValue] = useState('');
  const [tabMenu, setTabMenu] = useState<{ from: number; to: number; query: string } | null>(null);
  const [browserTabs, setBrowserTabs] = useState<chrome.tabs.Tab[]>([]);
  const [tabFailures, setTabFailures] = useState<Record<string, string>>({});
  const [activeReferenceChoice, setActiveReferenceChoice] = useState<number | null>(null);
  useEffect(() => {
    setTabMenu(null);
    setTabFailures({});
  }, [sessionId]);
  const tabMenuOpen = tabMenu !== null;
  const { sessions, loading: historyLoading } = useSessionList(tabMenuOpen);
  const historySelection = useRef(0);
  const [historyPending, setHistoryPending] = useState(false);
  useLayoutEffect(() => {
    setHistoryPending(false);
    return () => { historySelection.current++; };
  }, [tabMenu, sessionId, value]);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const tabTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!tabMenuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || tabMenuRef.current?.contains(target) || tabTriggerRef.current?.contains(target)) return;
      setTabMenu(null);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [tabMenuOpen]);
  useEffect(() => {
    if (!tabMenuOpen) return;
    let current = true;
    void Promise.all([chrome.windows.getCurrent(), chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })])
      .then(([active, windows]) => {
        if (current) setBrowserTabs(windows.sort((a, b) => Number(b.id === active.id) - Number(a.id === active.id)).flatMap((window) => window.tabs ?? []).filter((tab) => !tab.incognito));
      })
      .catch(() => { if (current) setBrowserTabs([]); });
    return () => { current = false; };
  }, [tabMenuOpen]);

  const tabDomain = (tab: chrome.tabs.Tab) => {
    try { return new URL(tab.url ?? '').hostname; } catch { return ''; }
  };
  const visibleTabs = tabMenu ? browserTabs.filter((tab) =>
    ((tab.title ?? '') + ' ' + tabDomain(tab)).toLowerCase().includes(tabMenu.query.toLowerCase())) : [];
  const referencedTabs = new Set(findTabReferences(value).map(({ ref }) => `${ref.tabId}:${ref.url}`));
  const selectableTabs = visibleTabs.filter((tab) => tab.id !== undefined);
  const tabTitle = (tab: chrome.tabs.Tab) => {
    const link = tab.url && tabLink(tab.url);
    return (tab.title !== tab.url && tab.title) || (link && tabDomain(tab)) || t('chat.composer.tabUntitled');
  };
  const historyChoices = sessions.filter((session) => session.id !== sessionId && session.messageCount > 0);
  const visibleHistory = tabMenu ? historyChoices.filter((session) =>
    session.title.toLowerCase().includes(tabMenu.query.trim().toLowerCase())) : [];
  useEffect(() => {
    if (!tabMenuOpen || activeReferenceChoice === null) return;
    tabMenuRef.current?.querySelector('[data-reference-highlighted]')?.scrollIntoView({ block: 'nearest' });
  }, [tabMenuOpen, activeReferenceChoice]);

  const insertTabs = (tabs: chrome.tabs.Tab[]) => {
    if (!tabMenu || !tabs.length) return;
    const tokens = tabs.flatMap((tab) => tab.id === undefined ? [] : [
      tabReferenceToken({ id: crypto.randomUUID(), tabId: tab.id, title: tabTitle(tab), url: tab.url ?? '' }),
    ]);
    const editor = editorRef.current;
    if (!editor || !tokens.length) return;
    const insertion = tokens.join(' ') + ' ';
    editor.replaceRange(tabMenu.from, tabMenu.to, insertion);
    const caret = tabMenu.from + insertion.length;
    editor.focus();
    setTabMenu({ ...tabMenu, from: caret, to: caret, query: '' });
    setActiveReferenceChoice(null);
  };
  // 光标正在编辑的 `/xxx` 词段（斜杠菜单触发器）；null = 不挂菜单。
  const [slashToken, setSlashToken] = useState<SlashToken | null>(null);
  const menuOpen = slashToken !== null;
  const [slashSearch, setSlashSearch] = useState<string | null>(null);
  // 本轮挂着的斜杠提示词。选中 `/x` 不把正文倒进输入框，而是在光标处插入一枚
  // `/名字` 内联胶囊（ComposerEditor 的 replace 装饰），正文在发送时自成信封里的一段，
  // 不掺进用户自己敲的话（issue #53）。胶囊是原子范围：整块删除，不可拆半。
  const insertHistory = async (id: string) => {
    if (!tabMenu || historyPending || isDispatchingRef.current) return;
    const seq = ++historySelection.current;
    const editor = editorRef.current;
    setHistoryPending(true);
    try {
      const token = await loadHistoryReference(id);
      if (historySelection.current !== seq || !editor || editorRef.current !== editor || isDispatchingRef.current) return;
      if (!token) {
        toast.error(t('chat.composer.historyReferenceUnavailable'));
        return;
      }
      editor.replaceRange(tabMenu.from, tabMenu.to, token + ' ');
      setTabMenu(null);
      editor.focus();
    } catch {
      if (historySelection.current === seq) toast.error(t('chat.composer.historyReferenceUnavailable'));
    } finally {
      if (historySelection.current === seq) setHistoryPending(false);
    }
  };

  const historyReferences = useMemo(() => findQuoteTokens(value).flatMap(({ title, sessionId }) =>
    title === undefined ? [] : [{ title, sessionId }]), [value]);
  const [slashPrompts, setSlashPrompts] = useState<SlashPrompt[]>([]);
  // 选中一条提示词要 await 读 VFS + 采集模板变量（页面脚本注入、剪贴板），期间用户可能
  // 已经切了会话、又点了另一条、把已挂的标记退格摘掉，或者干脆已经把消息发出去了。
  // 这四处都自增，选中落定前比对世代号，过期的结果直接丢弃。
  const slashPromptSeqRef = useRef(0);
  const [prompts, setPrompts] = useState<PromptMeta[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  // 内联 pill 与发送解析共用的派生值：文档里的 Skill 引用（按出现顺序、去重）。
  const promptNames = useMemo(() => prompts.map((p) => p.name), [prompts]);
  const docTokens = useMemo(() => findSkillTokens(value, skills, promptNames), [value, skills, promptNames]);
  const docSkills = useMemo(() => tokensToSkills(docTokens), [docTokens]);
  // Prompt 行对号与 Skill 同源：按文档里实际存在的引用派生，胶囊删掉对号即消失。
  const docPromptTokens = useMemo(() => findPromptTokens(value, promptNames), [value, promptNames]);

  // 已完成的 Prompt 胶囊与 Skill pill 一样抑制斜杠菜单：它是已提交的引用，不是开放查询。
  const menuTokens = useCallback((text: string) => [
    ...findSkillTokens(text, skills, promptNames),
    ...findPromptTokens(text, slashPrompts.map((p) => p.name)),
  ], [skills, promptNames, slashPrompts]);
  // 胶囊被移除（叉号 / 退格 / 整体改写）后 token 从文档消失，挂着的正文同步作废。
  useEffect(() => {
    const alive = slashPrompts.filter((p) => findPromptTokens(value, [p.name]).length > 0);
    if (alive.length !== slashPrompts.length) {
      setSlashPrompts(alive);
      slashPromptSeqRef.current++;
    }
  }, [value, slashPrompts]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [isPicking, setIsPicking] = useState(false);
  // History navigation: null = editing the current draft; otherwise points
  // into `userHistory`. `draft` stashes whatever the user had typed before
  // entering history mode so we can restore it on ↓-past-end.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const { supported: mobileSupported, isActiveTabMobile, toggle: toggleMobile } = useMobileEmulation();
  const editorRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashTriggerRef = useRef<HTMLButtonElement>(null);
  const slashSearchRef = useRef<HTMLInputElement>(null);
  const slashDismissed = useRef(false);
  const dismissSlashMenu = useCallback(() => {
    slashDismissed.current = true;
    setSlashToken(null);
    setSlashSearch(null);
  }, []);
  const sessionIdRef = useRef<string | null>(sessionId ?? null);
  sessionIdRef.current = sessionId ?? null;

  const [providers] = useStorageItem(providerCredentials, {});
  const [customProviderList] = useStorageItem(customProvidersStorage, []);
  // 任务运行中按 Enter 的交付方式（设置项）；Shift+⌘/Ctrl+Enter 用另一种（issue #96）
  const [defaultDelivery] = useStorageItem(followUpDelivery, 'queue');
  const otherDelivery: FollowUpDelivery = defaultDelivery === 'queue' ? 'steer' : 'queue';
  const otherShortcut = isApplePlatform() ? 'Shift+⌘+Enter' : 'Shift+Ctrl+Enter';

  // 当前模型解析成 pi-ai Model（内置 + 自定义统一走 resolveModel）。是否支持图片 /
  // 支持哪些思考档 等能力派生共用这一次解析，避免多份内联解析各自漂移
  const resolvedModel = useMemo(
    () => (currentModel ? resolveModel(currentModel, providers, customProviderList) : null),
    [currentModel, providers, customProviderList],
  );

  // 选中的模型是否还选得出来。`resolveModel` 不看凭据（凭据被删也照样解析成功），因此
  // 不能拿它当门禁——发送前的拦截与 ModelSelector 的失效标记共用 `isUsableModel`
  // 这一个判据（issue #62）。
  const modelUsable = useMemo(
    () => !!currentModel && isUsableModel(currentModel, providers, customProviderList),
    [currentModel, providers, customProviderList],
  );

  // 当前模型支持的思考档：pi 按模型 thinkingLevelMap 推导（非推理模型只返回 ['off']），
  // 多于一档可选时才显示选择器。存的档位可能超出当前模型上限（切到弱模型）→ 夹进支持集
  // 仅供高亮显示、不改全局偏好（切回强模型仍恢复）；后台派发时对同一模型做同样的 clamp，
  // 故显示与实际发出一致
  const thinkingLevels = useMemo(
    () => (resolvedModel ? getSupportedThinkingLevels(resolvedModel) : []),
    [resolvedModel],
  );
  const displayThinkingLevel = resolvedModel
    ? clampThinkingLevel(resolvedModel, currentThinkingLevel)
    : currentThinkingLevel;

  // 当前模型是否支持图片（多模态/VLM）输入：读 pi-ai Model.input 是否含 'image'
  const supportsImage = resolvedModel?.input?.includes('image') ?? false;

  // 截图 await 期间用户可能切到了纯文本模型，用 ref 同步读取最新的 supportsImage，
  // 避免迟到的截图被追加（文件读取的同类判断在 useComposerAttachments 里）。
  const supportsImageRef = useRef(supportsImage);
  supportsImageRef.current = supportsImage;

  // Guard the short dispatch window: recorder finalization plus prompt
  // delivery / one fast reconnect retry. Once the prompt is dispatched,
  // the composer becomes editable again while the agent replies.
  const isDispatchingRef = useRef(false);
  const [isDispatching, setIsDispatching] = useState(false);
  useEffect(() => {
    onDispatchingChange?.(isDispatching);
  }, [isDispatching, onDispatchingChange]);

  const isComposerLocked = useCallback(() => isDispatchingRef.current, []);
  const {
    attachments, getAttachments, freeSlots, updateAttachments, ingestFiles, waitForIntake,
  } = useComposerAttachments({ supportsImage, isLocked: isComposerLocked });

  const attachmentIds = useRef(new WeakMap<InlineAttachment, string>());
  const inlineAttachments = useMemo(() => {
    const inline = new Map<string, InlineAttachment>();
    for (const att of attachments) {
      if (att.type !== 'file' && att.type !== 'image') continue;
      const id = attachmentIds.current.get(att) ?? crypto.randomUUID();
      attachmentIds.current.set(att, id);
      inline.set(id, att);
    }
    return inline;
  }, [attachments]);
  const previousAttachmentTokens = useRef(new Set<string>());

  const handleModelSelect = useCallback((provider: string, modelId: string) => {
    onModelChange({ provider, modelId });
  }, [onModelChange]);

  const handleThinkingSelect = (level: ThinkingLevel) => {
    onThinkingChange(level);
  };

  // ─── 语音输入（本地优先、云端兜底的语音识别）──────────────────────
  // hook 持有在 ChatInput 这一层（而非 MicButton 内），因为识别结果要写进本
  // 输入框。
  //
  // 设计（「直接改 input」）：interim 直接作为 value 末尾的「未定稿后缀」写进
  // 真实 value——输入框始终可编辑（不 readOnly、不屏蔽键盘）。
  //
  // 两个 ref 保证正确：
  //  - interimSuffixRef：当前挂在 value 末尾的未定稿后缀（含补的空格），下一段
  //    interim/final 到来时按其长度精确剥掉再追加。
  //  - lastSpeechValueRef：上次由语音写入的完整 value。若当前 value 与之不等，
  //    说明用户/历史/斜杠菜单等外部路径改了 value——此时不剥旧后缀，直接以当前
  //    value 为新 base 往后追加，绝不删用户内容（符合「编辑时说话是用户自己的
  //    事」，且保证无数据丢失）。
  const valueRef = useRef(value);
  valueRef.current = value;
  const interimSuffixRef = useRef('');
  const lastSpeechValueRef = useRef(value);

  // 计算本次语音写入的 base：value 自上次语音写入后被外部改动 → 以当前 value 为
  // base（不剥后缀）；否则按已知后缀长度精确剥掉。
  const speechBase = (): string => {
    const cur = valueRef.current;
    // 外部改过 value（用户/历史/斜杠菜单），丢弃旧后缀跟踪，以当前 value 为 base。
    if (cur !== lastSpeechValueRef.current) return cur;
    const suffixLen = interimSuffixRef.current.length;
    return suffixLen > 0 ? cur.slice(0, cur.length - suffixLen) : cur;
  };

  const writeSpeechValue = (next: string, suffix: string) => {
    interimSuffixRef.current = suffix;
    lastSpeechValueRef.current = next;
    valueRef.current = next;
    setValue(next);
    setHistoryIndex(null);
  };

  // 实时中间结果：以当前 base 追加最新 interim 预览。
  const handleInterim = useCallback((interimRaw: string) => {
    const base = speechBase();
    const next = appendTranscript(base, interimRaw);
    writeSpeechValue(next, next.slice(base.length));
  }, []);

  // 每段 final（已清洗 + 经 correctTranscript）：以当前 base 追加正式文本，清空后缀。
  const commitTranscript = useCallback((text: string) => {
    const base = speechBase();
    const next = appendTranscript(base, text);
    writeSpeechValue(next, '');
  }, []);

  // 把当前未定稿的 interim 后缀就地清洗定稿，返回定稿后的文本。用于停止 / 发送
  // 前，确保「正在说的那句」不丢、且 CJK 空格被清掉。
  const finalizePendingInterim = useCallback((): string => {
    if (!interimSuffixRef.current) return valueRef.current;
    const base = speechBase();
    const finalized = appendTranscript(base, cleanTranscript(interimSuffixRef.current));
    writeSpeechValue(finalized, '');
    return finalized;
  }, []);

  // 归一化错误 → toast / 引导。`not-allowed` 兜底处理「query 返回 unknown 后
  // 实际未授权」的情况：打开授权页。
  const handleSpeechError = useCallback((kind: string) => {
    switch (kind) {
      case 'not-allowed':
        void openPermissionPage('microphone').then((opened) => {
          if (opened) toast.info(t('chat.composer.voiceNeedPermission'));
        });
        break;
      case 'language-unavailable':
        toast.error(t('chat.composer.voiceLanguageUnavailable'));
        break;
      case 'no-speech':
        toast.info(t('chat.composer.voiceNoSpeech'));
        break;
      case 'audio-capture':
        toast.error(t('chat.composer.voiceAudioCapture'));
        break;
      // network：云端识别连不上（如国内云端被墙 / 断网）——给网络专属提示。
      case 'network':
        toast.error(t('chat.composer.voiceNetworkFailed'));
        break;
      // unknown：无法归类，通用失败提示。
      case 'unknown':
        toast.error(t('chat.composer.voiceFailed'));
        break;
      // aborted 不会经此上报；其余忽略。
      default:
        break;
    }
  }, []);

  const speech = useSpeechRecognition({
    onInterim: handleInterim,
    onFinal: commitTranscript,
    onError: handleSpeechError,
  });

  const speechActive = speech.state === 'listening' || speech.state === 'preparing';

  // 点击麦克风：听写中→定稿当前 interim 并停止；否则按授权态决定直接听写 /
  // 开授权页 / 开设置页。
  const handleMicClick = useCallback(async () => {
    if (speechActive) {
      finalizePendingInterim();
      speech.stop();
      return;
    }
    const perm = await queryPermission('microphone');
    if (perm === 'granted' || perm === 'unknown') {
      // unknown：无法探测，乐观尝试；若实际未授权，识别会回 not-allowed 走引导。
      void speech.start();
      return;
    }
    if (perm === 'denied') {
      void openPermissionSettings('microphone').then((opened) => {
        if (opened) toast.error(t('chat.composer.voiceDenied'));
      });
      return;
    }
    // prompt：尚未授权，打开授权页让用户在普通标签页完成一次授权。
    void openPermissionPage('microphone').then((opened) => {
      if (opened) toast.info(t('chat.composer.voiceNeedPermission'));
    });
  }, [speechActive, finalizePendingInterim, speech]);

  // 输入框高度由 ComposerEditor 的 scroller 驱动（min-h-13 / max-h-37.5）；
  // 提示词标记是内联 widget，随内容自然滚动 / 换行，无需手动同步偏移。

  // Cancel picker on unmount
  useEffect(() => {
    return () => { cancelElementPicker(); };
  }, []);

  // Cancel picker on Esc key (sidepanel has focus, not the page)
  useEffect(() => {
    if (!isPicking) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelElementPicker();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPicking]);

  // 只挂了提示词、一个字没打也算可发——提示词本身就是这一轮的请求。
  const canSend = stripAttachmentTokens(value).trim().length > 0 || slashPrompts.length > 0 || attachments.length > 0;
  // 发送 / 停止共用一个按钮位（与 Claude / Codex 一致）：运行中输入框空着是停止键，打了字
  // 就变成按设置排队 / 插话的发送键，这时停止走 Esc。
  const canStop = isAgentRunning || agentBusy;
  const showStop = canStop && (!canSend || !isAgentRunning);

  // Recorder integration. The captured session lands in attachments via
  // the channel subscription in useComposerAttachments — NOT via
  // `recorder.stop()`'s return value. handleSend just needs to await stop()
  // so any in-flight session delivery completes before we read attachments.
  const recorder = useRecorder();

  /** `delivery`：任务运行中发送时的交付方式；空闲时不传。 */
  const handleSend = async (delivery?: FollowUpDelivery) => {
    if (!canSend) return;
    if (isDispatchingRef.current) return;
    // 没选模型 → 引导去选；选了但已失效（下架 / 凭据被删）→ 说明原因并让用户重选。
    // 在这里拦住，用户输入的文案就还留在输入框里，不会因为后台 throw 而白打一遍。
    if (!currentModel || !modelUsable) {
      toast.error(currentModel ? t('errors.modelUnavailable') : t('chat.composer.needModel'), {
        action: onOpenSettings ? { label: t('chat.composer.goToSettings'), onClick: () => onOpenSettings() } : undefined,
      });
      return;
    }

    // 发送前停止听写并把当前未定稿的 interim 就地清洗定稿，确保「正在说的那句」
    // 一并发出、且 CJK 空格被清掉。
    let outgoingText = value;
    if (speechActive) {
      outgoingText = finalizePendingInterim();
      speech.stop();
    }

    // Snapshot the text BEFORE any await so a fast follow-up edit doesn't
    // leak into the outgoing message.
    // 内联 Skill pill 与手敲的完整命令走同一条结构化路径：pill 从正文剥掉，
    // Skill 本体走信封里的 <selected-skills> 块。
    const tokens = findSkillTokens(outgoingText, skills, promptNames);
    // Prompt 胶囊与 Skill 同走结构化路径：token 从正文剥掉，正文走信封 <slash-prompt>。
    const promptTokens = findPromptTokens(outgoingText, slashPrompts.map((p) => p.name));
    // 信封里的提示词块按文档出现顺序、同名去重（同名胶囊共享同一份展开正文）。
    const promptsToSend: SlashPrompt[] = [];
    for (const token of promptTokens) {
      const picked = slashPrompts.find((p) => p.name === token.name);
      if (picked && !promptsToSend.some((p) => p.name === picked.name)) promptsToSend.push(picked);
    }
    const text = stripAttachmentTokens(stripSkillTokens(outgoingText, [...tokens, ...promptTokens])).trim();
    const skillsToSend = tokensToSkills(tokens);
    const references = [
      ...tokens.map(({ name, from, to }) => ({ kind: 'skill' as const, name, from, to })),
      ...promptTokens.map(({ name, from, to }) => ({ kind: 'prompt' as const, name, from, to })),
    ];

    const dispatchSessionId = sessionIdRef.current;

    isDispatchingRef.current = true;
    setIsDispatching(true);
    setTabMenu(null);
    // 作废在途的提示词选中。只靠 stillCurrent() 里那个 isDispatchingRef 快照不够：
    // 一整轮发送完全可能在选中的 await 窗口内起止（gatherTemplateVars 要注入页面脚本、
    // 读剪贴板，比一次纯文本发送慢得多），等选中落定时该标志已经变回 false，那条被
    // 放弃的提示词就会重新挂上，抹掉用户已经在写的下一条消息并抢走焦点。
    slashPromptSeqRef.current++;

    try {
      if (skillsToSend.length) {
        try { await resolveSelectedSkills(skillsToSend); }
        catch (error) { toast.error(error instanceof Error ? error.message : t('chat.composer.skillUnavailable')); return; }
      }
      // 等此前接受的文件全部读完落进附件，否则刚选完文件就发送会漏掉它们。
      // 上锁之后不再接受新文件（见 ingestFiles），所以队尾就是最后一批。
      await waitForIntake();
      if (sessionIdRef.current !== dispatchSessionId) return;
      if (recorder.isOwnerNow()) {
        // Pre-flight cap check: refuse to send if attachments are already
        // full — otherwise the about-to-be-delivered recording would be
        // silently dropped by the session subscription's overflow guard.
        if (getAttachments().length >= MAX_ATTACHMENT_COUNT) {
          toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
          return;
        }
        // Wait for the BG to finalize. The session is delivered (and
        // appended to the attachment list) synchronously by the channel
        // subscription in useComposerAttachments before this await resolves.
        await recorder.stop();
      }
      if (sessionIdRef.current !== dispatchSessionId) return;

      const outgoing = getAttachments();
      const positioned = new Set(findAttachmentTokens(outgoingText).map(({ id }) => id));
      const missingTokens: string[] = [];
      const displayAttachments = outgoing.flatMap((att) => {
        if (att.type !== 'file' && att.type !== 'image') return [];
        const id = attachmentIds.current.get(att) ?? crypto.randomUUID();
        if (!positioned.has(id)) missingTokens.push(attachmentToken(id));
        return [{ id, name: attachmentName(att), type: att.type }];
      });
      const displayText = [outgoingText, ...missingTokens].filter(Boolean).join(missingTokens.length ? ' ' : '');
      const composerDisplay = references.length || displayAttachments.length || findQuoteTokens(displayText).some(({ title }) => title !== undefined)
        ? { text: displayText, references, attachments: displayAttachments } : undefined;
      const result = await onSend(text, outgoing.length > 0 ? outgoing : undefined, dispatchSessionId, promptsToSend.length ? promptsToSend : undefined, delivery, skillsToSend.length ? skillsToSend : undefined, composerDisplay);
      if (result.status !== 'dispatched') {
        const failure = result.tabFailure;
        if (failure && sessionIdRef.current === dispatchSessionId) {
          const reason = failure.reason === 'closed' ? t('chat.composer.tabClosed')
            : failure.reason === 'navigated' ? t('chat.composer.tabChanged')
              : failure.reason === 'unreadable' ? t('chat.composer.tabUnavailable')
                : failure.reason === 'budget' ? t('chat.composer.tabBudget') : t('chat.composer.tabReadFailed');
          setTabFailures(Object.fromEntries(failure.ids.map((id) => [id, reason])));
          toast.error(t('chat.composer.tabSendBlocked', [reason]), {
            action: {
              label: t('chat.composer.removeFailedTabReferences'),
              onClick: () => {
                const editor = editorRef.current;
                if (!editor || isDispatchingRef.current || sessionIdRef.current !== dispatchSessionId) return;
                const draft = editor.getValue();
                const failedIds = new Set(failure.ids);
                const failed = findTabReferences(draft).filter(({ ref }) => failedIds.has(ref.id));
                if (!failed.length) return;
                const cleaned = failed.reverse().reduce((next, { from, to }) =>
                  next.slice(0, from) + next.slice(to + Number(draft[to] === ' ')), draft);
                editor.replaceRange(0, draft.length, cleaned);
                setTabFailures((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !failedIds.has(id))));
              },
            },
          });
        }
        return;
      }
      setTabFailures({});
      // 新对话首发：session_created 广播把 sessionId 从 null 换成本轮创建的 id。
      // 带 Skill 时要等后台 ack 才返回，广播早已落地——这属于本轮发送自身，
      // 不是「用户切了会话」，仍要清空输入框。
      const landedSessionId = result.sessionId ?? dispatchSessionId;
      if (sessionIdRef.current !== dispatchSessionId && sessionIdRef.current !== landedSessionId) return;

      setValue('');
      updateAttachments(() => []);
      setSlashPrompts([]);
      setSlashToken(null);
      setHistoryIndex(null);
      setDraft('');
    } finally {
      isDispatchingRef.current = false;
      setIsDispatching(false);
    }
  };

  // Reset history navigation when switching sessions. Also stop any active
  // dictation and drop the pending interim tracking so a late final from the
  // previous session can't append into the new session's composer
  // （speech.stop 在空闲时是无副作用的 no-op）。
  useEffect(() => {
    setHistoryIndex(null);
    setDraft('');
    setSlashPrompts([]);
    setSlashToken(null);
    slashPromptSeqRef.current++;
    interimSuffixRef.current = '';
    speech.stop();
  }, [sessionId, speech.stop]);

  /** ComposerEditor 的 keydown 代理：返回 true 表示已消费（CM 不再接手）。 */
  const handleReferenceKeyDown = (e: globalThis.KeyboardEvent, fromComposer = false): boolean => {
    if (!tabMenu || e.isComposing) return false;
    if (e.key === 'Escape') {
      setTabMenu(null);
      editorRef.current?.focus();
      return true;
    }
    const count = selectableTabs.length + visibleHistory.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const forward = e.key === 'ArrowDown';
      if (count) setActiveReferenceChoice((index) => index === null
        ? (forward ? 0 : count - 1)
        : (index + count + (forward ? 1 : -1)) % count);
      return true;
    }
    if (e.key !== 'Enter' || e.shiftKey) return false;
    if (historyPending) return true;
    if (activeReferenceChoice === null) {
      // After inserting a tab the picker stays open for more selections.
      // A collapsed range means there is no unfinished @ query to complete.
      return !fromComposer || tabMenu.from !== tabMenu.to;
    }
    const tab = selectableTabs[activeReferenceChoice];
    const history = visibleHistory[activeReferenceChoice - selectableTabs.length];
    if (tab) insertTabs([tab]);
    else if (history) void insertHistory(history.id);
    return true;
  };

  const handleKeyDown = (e: globalThis.KeyboardEvent): boolean => {
    // Don't intercept anything while the IME is composing (e.g. Chinese pinyin).
    if (e.isComposing) return false;
    if (handleReferenceKeyDown(e, true)) return true;

    if (isSlashMenuVisible && e.key === 'Tab' && !e.shiftKey && slashSearchRef.current) {
      slashSearchRef.current.focus();
      return true;
    }

    // Slash menu keyboard navigation. Only active while the menu is actually
    // rendered with at least one selectable item — when it's hidden (no
    // match) all keys fall through to the default editor behaviour
    // (history nav, send, etc.).
    if (isSlashMenuVisible && slashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        setSelectedPromptIndex((i) => (i + 1) % slashItems.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setSelectedPromptIndex((i) => (i - 1 + slashItems.length) % slashItems.length);
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const target = slashItems[selectedPromptIndex] ?? slashItems[0];
        if (target?.kind === 'prompt') void handlePromptSelect(target.prompt);
        if (target?.kind === 'skill') handleSkillSelect(target.skill);
        return true;
      }
    }
    // 菜单开着就关菜单，没有候选（「还没有提示词」/ 无匹配）时也一样；消费掉让
    // footer 上的 Esc 停止不再接手
    if (isSlashMenuVisible && e.key === 'Escape') {
      dismissSlashMenu();
      return true;
    }


    // ↑ / ↓ navigate previously sent user messages, but only when the caret
    // is at the absolute start (↑) or end (↓) of the composer, so multi-line
    // editing is never disturbed.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isSlashMenuVisible && userHistory && userHistory.length > 0) {
      const editor = editorRef.current;
      if (editor) {
        const sel = editor.getSelection();
        const len = editor.getValue().length;
        const moveCursor = (where: 'start' | 'end') => {
          requestAnimationFrame(() => {
            const el = editorRef.current;
            if (!el) return;
            const pos = where === 'end' ? el.getValue().length : 0;
            el.setSelectionRange(pos, pos);
          });
        };

        // 翻历史只换文本，不动挂着的提示词：「这一轮带什么指令」与「这一轮说什么话」
        // 是两件事。外部 `fill()` 同理。
        if (e.key === 'ArrowUp' && sel.start === 0 && sel.end === 0) {
          if (historyIndex === null) {
            setDraft(editor.getValue());
            const last = userHistory.length - 1;
            setHistoryIndex(last);
            setValue(userHistory[last]);
            moveCursor('start');
            return true;
          }
          if (historyIndex > 0) {
            const next = historyIndex - 1;
            setHistoryIndex(next);
            setValue(userHistory[next]);
            moveCursor('start');
            return true;
          }
          // Already at oldest entry — fall through.
        }

        if (e.key === 'ArrowDown' && historyIndex !== null && sel.start === len && sel.end === len) {
          if (historyIndex < userHistory.length - 1) {
            const next = historyIndex + 1;
            setHistoryIndex(next);
            setValue(userHistory[next]);
          } else {
            setHistoryIndex(null);
            setValue(draft);
          }
          moveCursor('end');
          return true;
        }
      }
    }

    // 任务运行中：Enter 按设置排队 / 插话，Shift+⌘/Ctrl+Enter 用另一种；空闲时两者都是普通发送
    if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      // 斜杠菜单开着时不发：`/xxx` 还没选成提示词，原样发出去不是用户想要的
      if (!isDispatching && !isSlashMenuVisible) void handleSend(isAgentRunning ? otherDelivery : undefined);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!isDispatching) void handleSend(isAgentRunning ? defaultDelivery : undefined);
      return true;
    }
    return false;
  };

  // 编辑一条排队消息：从后台取回完整内容并入输入框（已有内容时换行追加、附件合并）。
  // 取回即移出队列，所以凡是并不进来的情况都要在取回之前拦下。
  const editingQueuedRef = useRef(false);
  const handleEditQueued = async (item: QueuedPromptView) => {
    // 连点时第二次会拿到同一份取回结果，内容就会被并进来两遍
    if (isDispatchingRef.current || editingQueuedRef.current || !onTakeQueued) return;
    if (item.attachmentCount > freeSlots()) {
      toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
      return;
    }
    editingQueuedRef.current = true;
    let result: QueueTakeResult;
    try {
      result = await onTakeQueued(item.id);
    } finally {
      editingQueuedRef.current = false;
    }
    if (result.status !== 'taken') {
      toast.error(result.status === 'gone' ? t('errors.queuedMessageGone') : t('chat.session.notConnected'));
      return;
    }
    const taken = result.prompt;
    const existing = new Set(docSkills.map((s) => s.filePath));
    const skillSuffix = (taken.selectedSkills ?? [])
      .filter((s) => !existing.has(s.filePath))
      .map((s) => `/${s.name}`)
      .join(' ');
    // 提示词胶囊的 token 也要回填进文档，否则正文挂上了却没有胶囊可见。
    const suffix = [...(taken.slashPrompts ?? []).map((p) => `/${p.name}`), skillSuffix].filter(Boolean).join(' ');
    const restored = supportsImageRef.current
      ? taken.attachments
      : taken.attachments.filter((att) => att.type !== 'image');
    const remapped = new Map<string, string>();
    const queuedInline = taken.attachments.filter((att) => att.type === 'file' || att.type === 'image');
    taken.composerDisplay?.attachments?.forEach(({ id, type }, index) => {
      const att = queuedInline[index];
      if (att?.type !== type || !restored.includes(att)) return;
      const newId = crypto.randomUUID();
      attachmentIds.current.set(att, newId);
      remapped.set(id, attachmentToken(newId));
    });
    setValue((prev) => {
      if (taken.composerDisplay) {
        const text = describeAttachmentTokens(taken.composerDisplay.text, remapped);
        return prev.trim() ? `${prev}\n${text}` : text;
      }
      const { request } = splitTabReferenceContext(taken.text);
      const base = request ? (prev.trim() ? `${prev}\n${request}` : request) : prev;
      return suffix ? `${base}${base && !/\s$/.test(base) ? ' ' : ''}${suffix}` : base;
    });
    setHistoryIndex(null);
    const takenPrompts = taken.slashPrompts ?? [];
    if (takenPrompts.length) {
      slashPromptSeqRef.current++;
      setSlashPrompts((prev) => [...prev.filter((p) => !takenPrompts.some((q) => q.name === p.name)), ...takenPrompts]);
    }
    if (restored.length < taken.attachments.length) toast.info(t('chat.composer.imageStripped'));
    if (restored.length > 0) updateAttachments((prev) => [...prev, ...restored]);
    focusCaretAtEnd();
  };

  // 任务运行中按 Esc 停止（与 Claude / Codex 一致）：输入框有内容时停止键让位给发送键，靠它停。
  // 挂在 footer 上，焦点在输入区任一控件（工具栏、排队列表）都生效。不接手的情况：
  // 已被处理过的（斜杠菜单关菜单、Radix 弹层关闭都会 preventDefault）、从门户弹层冒泡上来的、
  // 输入法组字中、拾取元素中（document 上的监听负责取消拾取）。
  const handleFooterKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    if (!canStop || isPicking) return;
    e.preventDefault();
    onCancel?.();
  };

  const handleEditorUpdate = (text: string, caret: number, userTyped: boolean) => {
    setValue(text);
    const activeIds = new Set(findAttachmentTokens(text).map(({ id }) => id));
    const removed = [...previousAttachmentTokens.current].filter((id) => !activeIds.has(id) && inlineAttachments.has(id));
    previousAttachmentTokens.current = activeIds;
    if (removed.length) {
      const removedAttachments = new Set(removed.map((id) => inlineAttachments.get(id)));
      updateAttachments((prev) => prev.filter((att) => att.type !== 'file' && att.type !== 'image' || !removedAttachments.has(att)));
    }
    if (userTyped) {
      const mention = /(?:^|[^a-zA-Z0-9_@])@([^@\s⟦⟧]*)$/u.exec(text.slice(0, caret));
      setTabMenu(mention ? { from: caret - mention[1].length - 1, to: caret, query: mention[1] } : null);
      setActiveReferenceChoice(null);
    }
    if (userTyped) slashDismissed.current = false;
    if (!slashDismissed.current) setSlashToken(findSlashToken(text, caret, menuTokens(text)));
    // Manual edits exit history mode — the new content becomes the draft.
    if (userTyped && historyIndex !== null) setHistoryIndex(null);
  };

  /** 聚焦输入框并把光标移到末尾。value 是受控的，得等这一次提交渲染完再设光标。 */
  const focusCaretAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const end = el.getValue().length;
      el.setSelectionRange(end, end);
    });
  }, []);

  // 由外部（欢迎页示例卡片）填入文本并聚焦，不夺走输入框对 value 的所有权。
  const fill = useCallback((text: string) => {
    setValue(text);
    setSlashToken(findSlashToken(text, text.length, menuTokens(text)));
    setHistoryIndex(null);
    // 等 value 提交后再聚焦并把光标移到末尾，方便用户接着改。
    focusCaretAtEnd();
  }, [focusCaretAtEnd, menuTokens]);

  // 内联 pill 依赖已安装索引，挂载即扫一次；菜单打开时再刷（用户可能在别处导入过 Skill）。
  useEffect(() => {
    scanPrompts().then(setPrompts).catch(() => setPrompts([]));
    scanSkillIndex().then(setSkills).catch(() => setSkills([]));
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    scanPrompts().then(setPrompts).catch(() => setPrompts([]));
    scanSkillIndex().then(setSkills).catch(() => setSkills([]));
  }, [menuOpen]);

  // Filter prompts by typed search (after '/')
  const slashFilter = (slashSearch ?? slashToken?.filter ?? '').trim().toLowerCase();
  const filteredPrompts = slashFilter
    ? prompts.filter((p) => p.name.toLowerCase().includes(slashFilter) || p.description.toLowerCase().includes(slashFilter))
    : prompts;
  const filteredSkills = slashFilter
    ? skills.filter((s) => s.name.toLowerCase().includes(slashFilter) || s.description.toLowerCase().includes(slashFilter))
    : skills;
  const slashItems = [
    ...filteredPrompts.map((prompt) => ({ kind: 'prompt' as const, prompt })),
    ...filteredSkills.map((skill) => ({ kind: 'skill' as const, skill })),
  ];

  // Menu hides when the user has typed a search term that matches nothing —
  // in that case Enter falls through to send the literal `/xxx` text.
  // When the search is empty we keep the menu open even if there are no
  // prompts at all, so the user sees the "no prompts yet" empty state.
  const isSlashMenuVisible = menuOpen && (slashSearch !== null || slashFilter === '' || slashItems.length > 0);
  useEffect(() => {
    if (!isSlashMenuVisible) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !slashMenuRef.current?.contains(event.target)
        && !slashTriggerRef.current?.contains(event.target)) dismissSlashMenu();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [isSlashMenuVisible, dismissSlashMenu]);
  useEffect(() => {
    if (!menuOpen) setSlashSearch(null);
  }, [menuOpen]);

  // Clamp the highlighted index whenever the visible list changes.
  useEffect(() => {
    if (slashItems.length === 0) {
      setSelectedPromptIndex(0);
      return;
    }
    setSelectedPromptIndex((i) => Math.min(Math.max(i, 0), slashItems.length - 1));
  }, [slashItems.length]);

  const handleSkillSelect = (skill: SkillMeta) => {
    if (isDispatchingRef.current) return;
    const editor = editorRef.current;
    const token = slashToken;
    const already = docSkills.some((s) => s.filePath === skill.filePath);
    if (editor && token) {
      // 重复引用不再插第二枚 pill（resolveSelectedSkills 拒重复），只清掉筛选词。
      const after = value[token.to];
      const prevChar = token.from > 0 ? value[token.from - 1] : undefined;
      const lead = prevChar !== undefined && !/\s/.test(prevChar) ? ' ' : '';
      const insert = already ? '' : `${lead}/${skill.name}${after !== undefined && /\s/.test(after) ? '' : ' '}`;
      editor.replaceRange(token.from, token.to, insert);
    } else if (editor && !already) {
      const end = editor.getValue().length;
      editor.replaceRange(end, end, `/${skill.name} `);
    }
    setSlashToken(null);
  };

  // Reset highlight to the top whenever the menu (re)opens.
  useEffect(() => {
    if (isSlashMenuVisible) setSelectedPromptIndex(0);
  }, [isSlashMenuVisible]);

  // Keep the highlighted item in view when navigating with the keyboard.
  useEffect(() => {
    if (!isSlashMenuVisible) return;
    const el = slashMenuRef.current?.querySelector<HTMLElement>(`[data-prompt-index="${selectedPromptIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedPromptIndex, isSlashMenuVisible]);

  const readPromptBody = async (prompt: PromptMeta) => {
    const raw = await vfs.readFile(`${CEBIAN_PROMPTS_DIR}/${prompt.fileName}`, 'utf8');
    const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
    return parseFrontmatter(content).body.trim();
  };

  const restorePastedPrompts = async (text: string, names: readonly string[]) => {
    const candidates = prompts.filter(({ name }) => findPromptTokens(text, [name]).length > 0);
    if (!candidates.length || isDispatchingRef.current) return;
    const session = sessionIdRef.current;
    const seq = slashPromptSeqRef.current;
    const selected = names.flatMap((name) => candidates.find((prompt) => prompt.name === name) ?? []);
    if (!selected.length) return;
    try {
      const vars = await gatherTemplateVars();
      const restored = await Promise.allSettled(selected.map(async (prompt) => ({
        name: prompt.name,
        body: replaceTemplateVars(await readPromptBody(prompt), vars),
      })));
      if (sessionIdRef.current !== session || slashPromptSeqRef.current !== seq || isDispatchingRef.current) return;
      const live = restored.flatMap((result) =>
        result.status === 'fulfilled' && findPromptTokens(valueRef.current, [result.value.name]).length
          ? [result.value] : []);
      if (live.length) setSlashPrompts((prev) => [...prev, ...live.filter(({ name }) => !prev.some((p) => p.name === name))]);
    } catch {
      // Leave the inserted text editable if prompt expansion fails.
    }
  };

  // Handle prompt selection from slash menu
  const handlePromptSelect = async (prompt: PromptMeta) => {
    if (isDispatchingRef.current) return;
    const seq = ++slashPromptSeqRef.current;
    const selectedSessionId = sessionIdRef.current;
    // 选中那一刻输入框里的内容（就是用来筛选的 `/xxx`）。落定时按它剥前缀，
    // 等待期间接着敲进去的话必须原样留下。
    const queryAtSelect = value;
    const tokenAtSelect = slashToken;
    // 结果落定时仍是同一个会话、且没有更晚的选中把它顶掉，才允许写入。
    const stillCurrent = () =>
      !isDispatchingRef.current
      && slashPromptSeqRef.current === seq
      && sessionIdRef.current === selectedSessionId;
    try {
      const body = await readPromptBody(prompt);
      const vars = await gatherTemplateVars();
      // 模板变量在**选中的这一刻**展开：挂上去的正文就是最终会发出去的文本。
      const replaced = replaceTemplateVars(body, vars);
      if (!stillCurrent()) return;
      setSlashPrompts((prev) => [...prev.filter((p) => p.name !== prompt.name), { name: prompt.name, body: replaced }]);
      // 用来筛选的那截 `/xxx` 就地换成 `/名字 ` 胶囊 token——提示词挂在光标处，
      // 正文留在 state 里发送时进信封。读 VFS + 采集模板变量是个不短的 await，
      // 期间用户完全可能接着往下敲，那些字是他要发的正文，一个都不能抹掉。
      const insert = `/${prompt.name} `;
      setValue((v) => {
        // 优先按记录的词段位置换（菜单可在行中触发）；等待期间该段被改过再退回落底逻辑。
        if (tokenAtSelect) {
          const query = queryAtSelect.slice(tokenAtSelect.from, tokenAtSelect.to);
          if (query ? v.slice(tokenAtSelect.from, tokenAtSelect.to) === query : v === queryAtSelect) {
            const prev = tokenAtSelect.from > 0 ? v[tokenAtSelect.from - 1] : undefined;
            const lead = prev !== undefined && !/\s/.test(prev) ? ' ' : '';
            return v.slice(0, tokenAtSelect.from) + lead + insert + v.slice(tokenAtSelect.from + query.length).replace(/^[ \t]+/, '');
          }
        }
        if (v.startsWith(queryAtSelect)) return insert + v.slice(queryAtSelect.length).replace(/^[ \t]+/, '');
        // 等待期间把筛选词自己改短 / 改乱了：仍按「开头那截非空白」当筛选词换掉。
        if (v.startsWith('/')) return insert + v.replace(/^\/\S*/, '').replace(/^[ \t]+/, '');
        return insert + v;
      });
      setSlashToken(null);
      focusCaretAtEnd();
    } catch {
      if (stillCurrent()) toast.error(t('chat.composer.readPromptFailed'));
    }
  };

  const handlePickElement = async () => {
    if (isDispatchingRef.current) return;
    if (isPicking) {
      cancelElementPicker();
      return;
    }
    setIsPicking(true);
    try {
      const result = await startElementPicker();
      if (isDispatchingRef.current) return;
      switch (result.status) {
        case 'ok': {
          const att = result.attachment;
          // Deduplicate: same selector + same frameId
          const isDuplicate = getAttachments().some(
            (a) => a.type === 'element' && a.selector === att.selector && a.frameId === att.frameId,
          );
          if (isDuplicate) {
            toast.info(t('chat.composer.elementAdded'));
          } else if (freeSlots() <= 0) {
            toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
          } else {
            updateAttachments((prev) => [...prev, att]);
          }
          break;
        }
        case 'cancelled':
          break;
        case 'error':
          if (result.reason === 'unsupported-page') {
            toast.warning(t('chat.composer.elementPickUnsupported'));
          } else if (result.reason === 'navigation') {
            toast.warning(t('chat.composer.elementPickNavigated'));
          } else {
            toast.error(t('chat.composer.elementPickFailed'));
            if (result.message) console.error('[Element Picker]', result.message);
          }
          break;
      }
    } catch (err) {
      toast.error(t('chat.composer.elementPickFailed'));
      console.error('[Element Picker]', err);
    } finally {
      setIsPicking(false);
      editorRef.current?.focus();
    }
  };

  const handleScreenshot = async () => {
    if (isDispatchingRef.current) return;
    // 纯文本模型不支持截图（图片）输入，按钮也会被禁用，这里再兜底一次。
    if (!supportsImage) {
      toast.warning(t('chat.composer.modelNoImage'));
      return;
    }
    if (freeSlots() <= 0) {
      toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
      return;
    }
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 85 });
      if (isDispatchingRef.current) return;
      if (!supportsImageRef.current) return;
      // 截图 await 期间可能又进来了录制 / 文件，名额以此刻为准
      if (freeSlots() <= 0) {
        toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
        return;
      }
      const base64 = dataUrl.split(',', 2)[1] ?? '';
      updateAttachments((prev) => [
        ...prev,
        { type: 'image', source: 'screenshot', data: base64, mimeType: 'image/jpeg' },
      ]);
    } catch (err) {
      toast.error(t('chat.composer.screenshotFailed'));
      console.error('[Screenshot]', err);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) ingestFiles(Array.from(files), 'upload');
    // Reset input so the same file can be selected again
    e.target.value = '';
  };

  const restorePastedAttachments = (text: string, copied: Record<string, InlineAttachment>) => {
    const restored = new Map<string, InlineAttachment>();
    const tokens = findAttachmentTokens(text);
    let remaining = Math.max(0, freeSlots());
    for (const { id } of tokens) {
      if (restored.has(id) || remaining === 0) continue;
      const att = validateCopiedAttachment(copied[id], supportsImage);
      if (!att) continue;
      restored.set(id, att);
      attachmentIds.current.set(att, crypto.randomUUID());
      remaining--;
    }
    if (restored.size) updateAttachments((prev) => [...prev, ...restored.values()]);
    return tokens.reverse().reduce((result, { id, from, to }) => {
      const att = restored.get(id);
      const replacement = att ? attachmentToken(attachmentIds.current.get(att)!) : copied[id]?.name ?? '';
      return result.slice(0, from) + replacement + result.slice(to);
    }, text);
  };

  const handlePasteImages = (e: ClipboardEvent) => {
    if (isDispatchingRef.current) return;
    // 纯文本模型不接受粘贴的图片；文本粘贴由 ComposerEditor 统一插纯文本。
    if (!supportsImage) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    let hasPlainText = false;
    for (const item of Array.from(items)) {
      if (item.kind === 'string' && item.type === 'text/plain') {
        hasPlainText = true;
      } else if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }

    if (imageFiles.length === 0) return;
    ingestFiles(imageFiles, 'paste', hasPlainText ? 'quiet' : 'notify');
  };

  const removeAttachment = (index: number) => {
    if (isDispatchingRef.current) return;
    updateAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const addDroppedFiles = (files: readonly File[], folders: readonly string[]) => {
    if (isDispatchingRef.current) return;
    for (const name of folders) toast.error(t('errors.folderUnsupported', [name]));
    ingestFiles(files, 'upload');
  };

  // 不传依赖：addDroppedFiles 每次渲染都会换新，句柄跟着重建拿到最新闭包，重建一个小对象的开销可以忽略
  useImperativeHandle(ref, () => ({
    fill,
    addFiles: addDroppedFiles,
    insertQuote: (text) => {
      if (isDispatchingRef.current || !editorRef.current) return false;
      const editor = editorRef.current;
      const { end } = editor.getSelection();
      editor.replaceRange(end, end, quoteToken(text) + ' ');
      editor.focus();
      return true;
    },
  }));

  return (
    <footer className="px-4 py-4 border-t border-border bg-background relative" onKeyDown={handleFooterKeyDown}>
      {/* Slash menu — dynamic VFS prompts */}
      {isSlashMenuVisible && (
        <div
          ref={slashMenuRef}
          className="chat-menu-text absolute bottom-full left-4 right-4 mb-3 bg-popover border border-border rounded-lg shadow-xl z-50 animate-in slide-in-from-bottom-1 fade-in duration-150 overflow-hidden"
        >
          <div className="max-h-52 overflow-y-auto">
            {slashItems.length === 0 && !(prompts.length === 0 && slashFilter === '') ? (
              <p className="text-[0.85em] text-muted-foreground text-center py-3 px-2.5">
                {t('chat.composer.noMatch')}
              </p>
            ) : (
              <div className="py-1">
                {(filteredPrompts.length > 0 || (prompts.length === 0 && slashFilter === '')) && (
                  <p className="px-3 py-1 text-[0.85em] text-muted-foreground">Prompt</p>
                )}
                {filteredPrompts.length === 0 && prompts.length === 0 && slashFilter === '' && (
                  <button
                    type="button"
                    onClick={() => onOpenSettings?.('prompts')}
                    className="w-full px-3 py-2.5 text-center text-[0.85em] text-muted-foreground transition-colors hover:bg-accent/50"
                  >
                    {t('chat.composer.noPrompts')}
                  </button>
                )}
                {filteredPrompts.map((p, idx) => {
                  const selected = idx === selectedPromptIndex;
                  const referenced = docPromptTokens.some((token) => token.name === p.name);
                  return (
                    <button
                      key={p.fileName}
                      data-prompt-index={idx}
                      disabled={isDispatching}
                      onClick={() => handlePromptSelect(p)}
                      onMouseMove={() => { if (!isDispatching) setSelectedPromptIndex(idx); }}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${selected ? 'bg-accent' : 'hover:bg-accent/50'}`}
                    >
                      <FileText className="size-4 mt-0.5 shrink-0 text-success" />
                      <div className="flex-1 min-w-0">
                        <p className="chat-menu-text truncate text-success">{p.name}</p>
                        {p.description && (
                          <p className="text-[0.85em] text-muted-foreground truncate">{p.description}</p>
                        )}
                      </div>
                      {referenced && <Check aria-label={t('chat.composer.tabReferenced')} className="size-4 shrink-0 self-center text-primary" />}
                    </button>
                  );
                })}
                {filteredSkills.length > 0 && <p className="px-3 py-1 text-[0.85em] text-muted-foreground">Skill</p>}
                {filteredSkills.map((skill, offset) => {
                  const idx = filteredPrompts.length + offset;
                  const referenced = docTokens.some((token) => token.filePath === skill.filePath);
                  return (
                    <button
                      key={skill.filePath}
                      data-prompt-index={idx}
                      disabled={isDispatching}
                      onClick={() => handleSkillSelect(skill)}
                      onMouseMove={() => { if (!isDispatching) setSelectedPromptIndex(idx); }}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${idx === selectedPromptIndex ? 'bg-accent' : 'hover:bg-accent/50'}`}
                    >
                      <Box aria-hidden="true" className="size-4 mt-0.5 shrink-0 text-info" />
                      <div className="flex-1 min-w-0">
                        <p className="chat-menu-text truncate text-info">{skill.name}</p>
                        {skill.description && <p className="text-[0.85em] text-muted-foreground truncate">{skill.description}</p>}
                      </div>
                      {referenced && <Check aria-label={t('chat.composer.tabReferenced')} className="size-4 shrink-0 self-center text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="p-1.5">
            <input
              ref={slashSearchRef}
              type="search"
              className={MENU_SEARCH_CLASS}
              aria-label={t('chat.composer.searchPromptsAndSkills')}
              placeholder={t('chat.composer.searchPromptsAndSkills')}
              value={slashSearch ?? slashToken?.filter ?? ''}
              onFocus={() => setSlashSearch((query) => query ?? slashToken?.filter ?? '')}
              onChange={(event) => {
                setSlashSearch(event.target.value);
                setSelectedPromptIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape' || slashItems.length > 0) handleKeyDown(event.nativeEvent);
                if (event.key === 'Escape') editorRef.current?.focus();
              }}
            />
          </div>
        </div>
      )}

      <QueuedMessages
        queue={queue}
        paused={queuePaused}
        disabled={isDispatching}
        onSendNow={(id) => onSendQueuedNow?.(id)}
        onEdit={(item) => void handleEditQueued(item)}
        onRemove={(id) => onRemoveQueued?.(id)}
      />
      {isAgentRunning && canSend && (
        <p className="mb-1.5 px-1 text-[0.85em] text-muted-foreground">
          {defaultDelivery === 'queue'
            ? t('chat.composer.followUp.shortcutHint.queue', ['Enter', otherShortcut])
            : t('chat.composer.followUp.shortcutHint.steer', ['Enter', otherShortcut])}
        </p>
      )}

      <div className="relative border border-border rounded-xl bg-card focus-within:border-border/80 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        {tabMenu && (
          <div ref={tabMenuRef} role="region" aria-label={t('chat.composer.selectReferences')} className="chat-menu-text absolute bottom-full left-0 right-0 z-30 mb-1 rounded-xl border bg-popover p-1.5 shadow-lg">
            <div className="max-h-52 overflow-y-auto">
              <p className="px-2 py-1 text-[0.85em] text-muted-foreground">{t('chat.composer.tabListTitle')}</p>
              {!visibleTabs.length && <div className="p-2 text-[0.85em] text-muted-foreground">{t('chat.composer.noTabs')}</div>}
              {visibleTabs.map((tab) => {
                const id = tab.id;
                const disabled = id === undefined;
                const referenceOnly = !isReferenceableTab(tab.url);
                const referenced = id !== undefined && referencedTabs.has(`${id}:${tab.url ?? ''}`);
                const highlighted = activeReferenceChoice !== null && selectableTabs[activeReferenceChoice] === tab;
                return (
                  <button key={id ?? tab.index} type="button" disabled={disabled}
                    data-reference-highlighted={highlighted || undefined}
                    onMouseDown={(event) => event.preventDefault()} onClick={() => insertTabs([tab])}
                    onMouseMove={() => { if (!disabled) setActiveReferenceChoice(selectableTabs.indexOf(tab)); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 chat-menu-text text-left disabled:opacity-50 ${highlighted ? 'bg-accent' : ''}`}>
                    <span aria-hidden="true" className="relative size-4 shrink-0">
                      {tab.url && tabLink(tab.url) && tab.favIconUrl && <img key={tab.favIconUrl} src={tab.favIconUrl} alt="" referrerPolicy="no-referrer"
                        className="peer size-4 rounded-sm object-contain" onError={(event) => { event.currentTarget.hidden = true; }} />}
                      <Globe className="absolute inset-0 size-4 text-muted-foreground peer-[:not([hidden])]:hidden" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{tabTitle(tab)}</span>
                    <span className="max-w-[40%] truncate text-[0.85em] text-muted-foreground">
                      {disabled ? t('chat.composer.tabUnavailable') : referenceOnly ? t('chat.composer.tabBodyUnavailable') : tabDomain(tab)}
                    </span>
                    <Check aria-label={referenced ? t('chat.composer.tabReferenced') : undefined} aria-hidden={!referenced}
                      data-tab-referenced={referenced || undefined}
                      className={`size-4 shrink-0 text-primary ${referenced ? '' : 'invisible'}`} />
                  </button>
                );
              })}
              <p className="px-2 py-1 text-[0.85em] text-muted-foreground">{t('common.history')}</p>
              {historyLoading && <p className="px-2 py-1 text-[0.85em] text-muted-foreground">{t('common.loading')}</p>}
              {!historyLoading && !visibleHistory.length && <p className="px-2 py-1 text-[0.85em] text-muted-foreground">{t('common.empty.history')}</p>}
              {visibleHistory.map((session, index) => {
                const title = session.title.trim().slice(0, 512) || 'Chat';
                const choice = selectableTabs.length + index;
                const highlighted = activeReferenceChoice === choice;
                const referenced = historyReferences.some((ref) => ref.sessionId === session.id)
                  || (historyReferences.some((ref) => !ref.sessionId && ref.title === title)
                    && historyChoices.filter((item) => (item.title.trim().slice(0, 512) || 'Chat') === title).length === 1);
                return (
                  <button key={session.id} type="button" title={session.title} disabled={historyPending || isDispatching}
                    data-reference-highlighted={highlighted || undefined}
                    onMouseDown={(event) => event.preventDefault()} onClick={() => void insertHistory(session.id)}
                    onMouseMove={() => { if (!historyPending && !isDispatching) setActiveReferenceChoice(choice); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 chat-menu-text text-left disabled:opacity-50 ${highlighted ? 'bg-accent' : ''}`}>
                    <History className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    {referenced && <Check aria-label={t('chat.composer.tabReferenced')} className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
            <input className={MENU_SEARCH_CLASS + " mt-1"}
              aria-label={t('chat.composer.searchReferences')} placeholder={t('chat.composer.searchReferences')}
              value={tabMenu.query} onChange={(event) => {
                setActiveReferenceChoice(null);
                setTabMenu({ ...tabMenu, query: event.target.value });
              }}
              onKeyDown={(event) => { if (handleReferenceKeyDown(event.nativeEvent)) event.preventDefault(); }} />
          </div>
        )}
        {/* Top row: tools + attachments */}
        <div className="flex items-center gap-0.5 px-2.5 pt-2.5 pb-2">
          <ComposerUploadButton disabled={isDispatching} onUpload={() => fileInputRef.current?.click()} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={`${supportsImage ? 'image/*,' : ''}.txt,.md,.csv,.tsv,.log,.js,.ts,.jsx,.tsx,.mjs,.cjs,.py,.java,.c,.cpp,.h,.hpp,.go,.rs,.rb,.php,.sh,.bash,.sql,.yaml,.yml,.toml,.ini,.cfg,.json,.xml,.html,.htm,.css,.scss,.less,.env,.gitignore,.editorconfig`}
            className="hidden"
            disabled={isDispatching}
            onChange={handleFileUpload}
          />
          <ComposerToolTooltip label={t('chat.composer.selectReferences')}>
            <Button ref={tabTriggerRef} type="button" variant="ghost" size="icon-xs" className="size-7"
              aria-label={t('chat.composer.selectReferences')}
              aria-expanded={tabMenuOpen} disabled={isDispatching}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (tabMenu) { setTabMenu(null); return; }
                const selection = editorRef.current?.getSelection() ?? { start: value.length, end: value.length };
                setActiveReferenceChoice(null);
                setTabMenu({ from: selection.start, to: selection.end, query: '' });
                requestAnimationFrame(() => tabMenuRef.current?.querySelector('input')?.focus());
              }}>
              <AtSign className="size-3.5" />
            </Button>
          </ComposerToolTooltip>
          <ComposerToolTooltip label={t('chat.composer.selectPromptsAndSkills')}>
            <Button ref={slashTriggerRef} type="button" variant="ghost" size="icon-xs" className="size-7"
              aria-label={t('chat.composer.selectPromptsAndSkills')}
              aria-expanded={isSlashMenuVisible} disabled={isDispatching}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (isSlashMenuVisible) { dismissSlashMenu(); return; }
                const at = editorRef.current?.getSelection().end ?? value.length;
                editorRef.current?.focus();
                setTabMenu(null);
                setSlashSearch('');
                setSlashToken({ from: at, to: at, filter: '' });
              }}>
              <Paperclip className="size-3.5" />
            </Button>
          </ComposerToolTooltip>
          <ComposerToolTooltip label={isPicking ? t('chat.composer.cancelPick') : t('chat.composer.pickElement')}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={isPicking ? t('chat.composer.cancelPick') : t('chat.composer.pickElement')}
              onClick={handlePickElement}
              disabled={isDispatching}
              className={`size-7 ${isPicking ? 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary' : ''}`}
            >
              <MousePointer2 className="size-3.5" />
            </Button>
          </ComposerToolTooltip>
          <RecordButton disabled={isDispatching} />
          <ComposerToolTooltip label={supportsImage ? t('chat.composer.screenshot') : t('chat.composer.modelNoImage')}>
            <Button variant="ghost" size="icon-xs" aria-label={t('chat.composer.screenshot')}
              onClick={handleScreenshot} disabled={isDispatching || !supportsImage} className="size-7">
              <Camera className="size-3.5" />
            </Button>
          </ComposerToolTooltip>
          {mobileSupported && (
            <ComposerToolTooltip label={t('chat.composer.mobileMode')}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('chat.composer.mobileMode')}
                className={`size-7 ${isActiveTabMobile ? 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary' : ''}`}
                onClick={toggleMobile}
                disabled={isDispatching}
              >
                <Smartphone className="size-3.5" />
              </Button>
            </ComposerToolTooltip>
          )}

          {attachments.some((att) => att.type === 'recording' || att.type === 'element') && (
            <>
              <Separator orientation="vertical" className="h-4! mx-1 bg-border" />

              {/* Attachment chips */}
              <div className="flex gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none items-center">
                {attachments.map((att, i) => (
                  att.type === 'file' || att.type === 'image' ? null : att.type === 'recording' ? (
                    // Recording attachment: amber chip mirroring Message.tsx;
                    // chip body downloads the JSON, X removes from the list.
                    // 录了网络时多一个按钮下载 HAR（完整网络记录）。
                    <Badge
                      key={i}
                      variant="outline"
                      className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-0.5 text-amber-400 border-amber-400/20 bg-amber-400/5 hover:bg-amber-400/10"
                      title={recordingTitle(att)}
                    >
                      <button
                        className="flex items-center gap-1 cursor-pointer"
                        onClick={() => downloadFile(att.name, att.json, RECORDING_MIME)}
                      >
                        <Film className="size-2.5 shrink-0" />
                        <span className="truncate max-w-24">{att.name}</span>
                        <span className="shrink-0">· {recordingMetaText(att)}</span>
                      </button>
                      {att.har && (
                        <button
                          className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                          title={t('chat.attachments.recordingHarDownload')}
                          aria-label={t('chat.attachments.recordingHarDownload')}
                          onClick={() => downloadFile(att.har!.name, att.har!.json, 'application/json')}
                        >
                          <Network className="size-2.5" />
                        </button>
                      )}
                      <button
                        className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                        disabled={isDispatching}
                        onClick={() => removeAttachment(i)}
                      >
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  ) : (
                    <Badge
                      key={i}
                      variant="outline"
                      className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-0.5 text-info border-info/20 bg-info/5"
                    >
                      <Crosshair className="size-2.5 shrink-0" />
                      <span className="truncate max-w-24">{att.selector}</span>

                      <button
                        className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                        disabled={isDispatching}
                        onClick={() => removeAttachment(i)}
                      >
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  )
                ))}
              </div>
            </>
          )}
        </div>

        {/* Rich-text composer: inline Skill pills + position-0 prompt mark, scrolling with content. */}
        <ComposerEditor
          ref={editorRef}
          value={value}
          onUpdate={handleEditorUpdate}
          tabFailures={tabFailures}
          inlineAttachments={inlineAttachments}
          skills={skills}
          promptNames={promptNames}
          slashPrompts={slashPrompts}
          placeholder={t('chat.composer.placeholder')}
          disabled={isDispatching}
          onKeyDown={handleKeyDown}
          onPasteImages={handlePasteImages}
          onPasteAttachments={restorePastedAttachments}
          onPasteText={restorePastedPrompts}
          onDropFiles={(files) => addDroppedFiles(files, [])}
          className="chat-text-input chat-font text-foreground"
        />

        {/* Bottom row: actions */}
        <div className="flex items-center justify-between px-2 pb-1.5">
          <div className={`flex items-center gap-0.5 ${isDispatching ? 'pointer-events-none opacity-60' : ''}`}>
            <ModelSelector
              activeModel={currentModel}
              configuredProviders={providers}
              customProviders={customProviderList}
              onSelect={handleModelSelect}
              showAddModels
            />
            {thinkingLevels.length > 1 && (
              <ThinkingLevelSelector
                level={displayThinkingLevel}
                levels={thinkingLevels}
                onSelect={handleThinkingSelect}
              />
            )}
          </div>

          <div className="flex items-center gap-1">
            <ContextUsageIndicator usage={contextUsage} onCompact={onCompact} busy={agentBusy || isDispatching} />
            {speech.supported && (
              <MicButton
                state={speech.state}
                onClick={() => { void handleMicClick(); }}
                disabled={isDispatching}
              />
            )}
            {showStop ? (
              <Button
                variant="destructive"
                size="icon-xs"
                onClick={() => onCancel?.()}
                title={t('chat.composer.stop')}
                aria-label={t('chat.composer.stop')}
                className="size-7 hover:shadow-xs"
              >
                <Square className="size-3.5" fill="currentColor" />
              </Button>
            ) : null}
            {showStop && !canSend ? null : isAgentRunning ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void handleSend(defaultDelivery)}
                disabled={isDispatching}
                title={t(defaultDelivery === 'queue' ? 'chat.composer.followUp.queue' : 'chat.composer.followUp.steer')}
                aria-label={t(defaultDelivery === 'queue' ? 'chat.composer.followUp.queue' : 'chat.composer.followUp.steer')}
                className="size-7 bg-foreground text-background hover:bg-primary hover:text-primary-foreground hover:shadow-xs disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {defaultDelivery === 'queue' ? <ListPlus className="size-3.5" /> : <CornerDownRight className="size-3.5" />}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void handleSend()}
                disabled={!canSend || isDispatching}
                aria-label={t('common.send')}
                className="size-7 bg-foreground text-background hover:bg-primary hover:text-primary-foreground hover:shadow-xs disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
});
