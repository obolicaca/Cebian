export function quoteToken(text: string): string {
  const encoded = JSON.stringify(text).replaceAll('<', '\\u003c').replaceAll('/', '\\u002f')
    .replaceAll('⟦', '\\u27e6').replaceAll('⟧', '\\u27e7');
  return `⟦cebian-quote:${encoded}⟧`;
}

export function findQuoteTokens(text: string) {
  return Array.from(text.matchAll(/⟦cebian-quote:("(?:[^"\\]|\\.)*")⟧/gu)).flatMap((match) => {
    try {
      const quote: unknown = JSON.parse(match[1]);
      return typeof quote === 'string' ? [{ quote, from: match.index, to: match.index + match[0].length }] : [];
    } catch {
      return [];
    }
  });
}

export function displayQuotedText(text: string): string {
  return findQuoteTokens(text).reverse().reduce((value, item) =>
    value.slice(0, item.from) + '“' + item.quote + '”' + value.slice(item.to), text);
}
