export function quoteToken(text: string): string {
  const encoded = JSON.stringify(text).replaceAll('<', '\\u003c').replaceAll('/', '\\u002f')
    .replaceAll('⟦', '\\u27e6').replaceAll('⟧', '\\u27e7');
  return `⟦cebian-quote:${encoded}⟧`;
}

export const MAX_HISTORY_REFERENCE_LENGTH = 12_000;

export function historyQuoteToken(title: string, transcript: string, sessionId?: string): string {
  return `⟦cebian-history:${encodeURIComponent(JSON.stringify([title, transcript, sessionId]))}⟧`;
}

interface QuoteToken {
  from: number;
  to: number;
  quote: string;
  title?: string;
  sessionId?: string;
}

export function findQuoteTokens(text: string): QuoteToken[] {
  return Array.from(text.matchAll(/⟦cebian-(?:quote:("(?:[^"\\]|\\.)*")|history:([^⟧\s]+))⟧/gu)).flatMap<QuoteToken>((match) => {
    const range = { from: match.index, to: match.index + match[0].length };
    try {
      if (match[2]) {
        const value: unknown = JSON.parse(decodeURIComponent(match[2]));
        if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string'
          && value[0].length <= 512 && value[1].length <= MAX_HISTORY_REFERENCE_LENGTH) {
          return [{ ...range, title: value[0], quote: value[1], sessionId: typeof value[2] === 'string' ? value[2] : undefined }];
        }
        return [];
      }
      const quote: unknown = JSON.parse(match[1]);
      return typeof quote === 'string' ? [{ ...range, quote, title: undefined }] : [];
    } catch {
      return [];
    }
  });
}

export function displayQuotedText(text: string): string {
  return findQuoteTokens(text).reverse().reduce((value, item) =>
    value.slice(0, item.from) + '“' + (item.title ?? item.quote) + '”' + value.slice(item.to), text);
}
