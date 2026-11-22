import { contentText } from '@earendil-works/pi-ai';
import { describeAttachmentTokens } from './attachment-tokens';
import { loadHistoryConversation } from './history-reference';
import {
  extractComposerDisplay, extractSelectedSkillNames, extractSlashPrompts,
  extractUserAttachments, extractUserText, getAssistantText, getThinkingBlocks, getToolCalls,
} from './message-helpers';
import { displayQuotedText } from './quote-tokens';
import { describeTabReferences } from './tab-references';

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function codeBlock(text: string, language = ''): string {
  const length = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3);
  const fence = '`'.repeat(length);
  return fence + language + '\n' + text + '\n' + fence;
}

type HistoryConversation = NonNullable<Awaited<ReturnType<typeof loadHistoryConversation>>>;

export function formatHistoryMarkdown({ title, messages }: HistoryConversation): string {
  const sections = [`# ${singleLine(title) || 'Chat'}`];
  for (const msg of messages) {
    if (msg.role === 'user') {
      const display = extractComposerDisplay(msg);
      const attachments = extractUserAttachments(msg);
      const names = new Map(display?.attachments?.map((att) => [att.id, att.name]));
      const prefix = display ? [] : [...extractSelectedSkillNames(msg), ...extractSlashPrompts(msg).map(({ name }) => name)].map((name) => '/' + name);
      const text = displayQuotedText(describeAttachmentTokens(describeTabReferences(display?.text ?? extractUserText(msg)), names)).trim();
      const details = [
        ...attachments.files.map(({ name, content }) => `- File: ${singleLine(name)}` + (content === undefined ? '' : '\n\n' + codeBlock(content))),
        ...attachments.images.map((_, i) => {
          const name = display?.attachments?.filter((att) => att.type === 'image')[i]?.name;
          return `- Image: ${singleLine(name ?? String(i + 1))}`;
        }),
        ...attachments.elements.map(({ selector }) => `- Page element: ${singleLine(selector)}`),
        ...attachments.recordings.map(({ name, json }) => `- Recording: ${singleLine(name)}\n\n${codeBlock(json, 'json')}`),
      ];
      sections.push(['## User', [...prefix, text].filter(Boolean).join(' '), ...details].filter(Boolean).join('\n\n'));
    } else if (msg.role === 'assistant') {
      const thinking = getThinkingBlocks(msg).map(({ thinking }) => codeBlock(thinking));
      const calls = getToolCalls(msg).map(({ name, arguments: args }) =>
        `### Tool call: ${singleLine(name)}\n\n${codeBlock(JSON.stringify(args, null, 2) ?? '', 'json')}`);
      sections.push(['## Assistant', ...thinking.map((text) => '### Thinking\n\n' + text), getAssistantText(msg), ...calls].filter(Boolean).join('\n\n'));
    } else if (msg.role === 'toolResult') {
      const text = contentText(msg.content, '');
      sections.push([`## Tool result: ${singleLine(msg.toolName)}`, text && codeBlock(text)].filter(Boolean).join('\n\n'));
    }
  }
  return sections.join('\n\n') + '\n';
}

export function historyMarkdownFilename(title: string, sessionId: string): string {
  const filename = singleLine(title).replace(/[<>:"/\\|?*]/g, '-').slice(0, 100).replace(/[. ]+$/, '');
  return `chat-${filename || sessionId}.md`;
}

export async function loadHistoryMarkdown(sessionId: string): Promise<string> {
  const conversation = await loadHistoryConversation(sessionId);
  if (!conversation) throw new Error('Conversation not found');
  return formatHistoryMarkdown(conversation);
}
