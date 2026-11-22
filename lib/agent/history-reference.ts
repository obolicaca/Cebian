import { getSession, sessionTreeDb } from '@/lib/persistence/db';
import { DexieSessionRepo } from '@/lib/persistence/session-tree';
import { describeTabReferences } from './tab-references';
import { displayQuotedText, historyQuoteToken, MAX_HISTORY_REFERENCE_LENGTH } from './quote-tokens';
import { extractUserText, getAssistantText } from './message-helpers';

export async function loadHistoryConversation(sessionId: string) {
  const session = await getSession(sessionId);
  if (!session) return;
  const tree = session.treeMigrationFailed ? null : await new DexieSessionRepo(sessionTreeDb).open(session);
  const entries = await tree?.findEntriesOnBranch({ order: 'oldestFirst' });
  const messages = entries ? entries.flatMap((entry) => entry.type === 'message' ? [entry.message] : []) : session.messages;
  return { title: session.title, messages };
}

export async function loadHistoryReference(sessionId: string): Promise<string | undefined> {
  const conversation = await loadHistoryConversation(sessionId);
  if (!conversation) return;
  const { title, messages } = conversation;
  const lines: string[] = [];
  let remaining = MAX_HISTORY_REFERENCE_LENGTH;
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const raw = msg.role === 'user' ? extractUserText(msg) : getAssistantText(msg);
    const text = displayQuotedText(describeTabReferences(raw)).trim();
    if (!text) continue;
    const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
    const available = remaining - prefix.length;
    if (available <= 0) break;
    const excerpt = text.length > available ? '…' + text.slice(text.length - available + 1) : text;
    const line = prefix + excerpt;
    lines.push(line);
    remaining -= line.length + 2;
  }
  return lines.length ? historyQuoteToken(title.trim().slice(0, 512) || 'Chat', lines.reverse().join('\n\n'), sessionId) : undefined;
}
