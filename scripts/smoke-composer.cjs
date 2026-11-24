/**
 * From the repository root after pnpm build:
 *   npm install --prefix .scratch/browser-smoke playwright-core
 *   node .scratch/browser-smoke/node_modules/playwright-core/cli.js install chromium
 *   node scripts/smoke-composer.cjs
 * Set CHROME_EXECUTABLE_PATH to use an existing browser that supports loading extensions by CLI flag.
 */
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, '.output', 'chrome-mv3');
const playwright = path.join(root, '.scratch', 'browser-smoke', 'node_modules', 'playwright-core');
const reply = 'Composer smoke test reply';
const fixture = 'Composer smoke test page';
const referencedText = 'Read the referenced fixture';
const testDisconnect = 'smoke_test_disconnect';

function serveFixture(request, response) {
  if (request.url === '/fixture') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>${fixture}</title><main><p>Local browser test content.</p></main>`);
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  request.resume();
  request.once('end', () => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: reply }, null], [{}, 'stop']]) {
      response.write(`data: ${JSON.stringify({
        id: 'smoke', object: 'chat.completion.chunk', created: 1, model: 'smoke-model',
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
}

async function configureWorker(worker, origin) {
  await worker.evaluate(async ({ origin, testDisconnect }) => {
    let composerPort;
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'cebian-client') composerPort = port;
    });
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === testDisconnect) composerPort?.disconnect();
    });
    await chrome.storage.local.set({
      customProviders: [{
        id: 'smoke', name: 'Smoke test', baseUrl: origin + '/v1',
        models: [{ modelId: 'smoke-model', name: 'Smoke model', reasoning: false, image: false, toolCalling: false }],
      }],
      activeModel: { provider: 'custom:smoke', modelId: 'smoke-model' },
      providerCredentials: { 'custom:smoke': { authType: 'apiKey', apiKey: 'local-test-key' } },
    });
  }, { origin, testDisconnect });
}

async function verifyCaret(page, composer, theme) {
  const cursor = page.locator('footer .cm-cursor-primary');
  await cursor.waitFor({ timeout: 4000 });
  const styles = await cursor.evaluate((element) => ({
    caretColor: getComputedStyle(element).borderLeftColor,
    textColor: getComputedStyle(element.closest('.cm-scroller').querySelector('.cm-content')).color,
  }));
  assert.equal(styles.caretColor, styles.textColor, `Caret should match the text color in ${theme} mode`);
  assert.ok((await cursor.boundingBox()).height > 0, 'The empty composer should have a visible caret');
  const opacity = await page.locator('footer .cm-cursorLayer').evaluate((layer) => {
    const animation = layer.getAnimations()[0];
    if (!animation || animation.playState !== 'running') throw new Error('Caret blink is not running');
    const duration = Number(animation.effect.getComputedTiming().duration);
    try {
      animation.pause();
      animation.currentTime = duration * 0.25;
      const on = getComputedStyle(layer).opacity;
      animation.currentTime = duration * 0.75;
      return [on, getComputedStyle(layer).opacity];
    } finally {
      animation.play();
    }
  });
  assert.deepEqual(opacity, ['1', '0']);

  await page.keyboard.insertText('abcdef');
  const line = composer.locator('.cm-line').first();
  const point = await line.evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.firstChild, 2);
    range.collapse(true);
    const target = range.getBoundingClientRect();
    const origin = element.getBoundingClientRect();
    return { x: target.left - origin.left, y: target.top - origin.top + target.height / 2 };
  });
  const waitForCaretAt = (offset) => page.waitForFunction((expected) => {
    const line = document.querySelector('footer .cm-line');
    const cursor = document.querySelector('footer .cm-cursor-primary');
    if (!line?.firstChild || !cursor) return false;
    const expectedPosition = document.createRange();
    expectedPosition.setStart(line.firstChild, expected);
    expectedPosition.collapse(true);
    return Math.abs(cursor.getBoundingClientRect().left - expectedPosition.getBoundingClientRect().left) < 2;
  }, offset, { timeout: 4000 });
  await line.click({ position: point });
  await waitForCaretAt(2);
  await page.keyboard.press('ArrowRight');
  await waitForCaretAt(3);
  await page.keyboard.press('ArrowLeft');
  await waitForCaretAt(2);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  console.log(`PASS (${process.platform}): ${theme} caret follows mouse and arrows, contrasts and blinks`);
}

async function verifyComposer(context, origin, hasExistingTurn, theme) {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await configureWorker(worker, origin);
  const sourcePage = await context.newPage();
  await sourcePage.goto(origin + '/fixture');
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!chrome.runtime?.connect) return;
    const connect = chrome.runtime.connect.bind(chrome.runtime);
    let dropped = false;
    chrome.runtime.connect = (...args) => {
      const port = connect(...args);
      if (port.name === 'cebian-client') {
        const addListener = port.onMessage.addListener.bind(port.onMessage);
        port.onMessage.addListener = (listener) => addListener((message, ...rest) => {
          if (!dropped && message.type === 'prompt_ack') {
            dropped = true;
            return;
          }
          listener(message, ...rest);
        });
      }
      return port;
    };
  });
  await page.goto('chrome-extension://' + new URL(worker.url()).host + '/sidepanel.html');
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: 'attached' });
  const composer = page.locator('footer .cm-content');
  const replies = page.locator('[data-quote-source]').getByText(reply, { exact: true });
  const stop = page.locator('footer button:has(svg.lucide-square)');
  const checkReply = async (index) => {
    await replies.nth(index).waitFor({ timeout: 15_000 });
    await stop.waitFor({ state: 'hidden', timeout: 8_000 });
  };
  const focusComposer = async () => {
    await composer.click();
    assert.ok(await composer.evaluate((input) => input === document.activeElement), 'A mouse click should focus the chat composer');
  };

  await focusComposer();
  await verifyCaret(page, composer, theme);
  if (theme === 'light') {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' });
    assert.ok(await composer.evaluate((input) => input === document.activeElement), 'Switching themes should keep the caret focused');
    await verifyCaret(page, composer, 'dark after switching');
  }
  if (hasExistingTurn) {
    await page.keyboard.insertText('Start the conversation');
    await page.keyboard.press('Enter');
    await checkReply(0);
    await focusComposer();
  }
  await page.keyboard.insertText('@');
  await page.locator('footer button').filter({ hasText: fixture }).click({ timeout: 10_000 });
  await composer.locator('[data-tab-reference]').waitFor();
  await page.keyboard.insertText(referencedText);
  await page.keyboard.press('Enter');

  const interruptedReply = hasExistingTurn ? 1 : 0;
  await checkReply(interruptedReply);
  assert.equal(await composer.getAttribute('contenteditable'), 'false', 'Test did not intercept the send confirmation');
  await page.evaluate((type) => chrome.runtime.sendMessage({ type }), testDisconnect);
  await page.waitForFunction(() => document.querySelector('footer .cm-content')?.isContentEditable, null, { timeout: 5_000 });
  assert.match(await composer.innerText(), /Read the referenced fixture/);
  await focusComposer();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('Send again after reconnect');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('Second line');
  assert.deepEqual(await composer.locator('.cm-line').allTextContents(), ['Send again after reconnect', 'Second line']);
  await page.keyboard.press('Enter');
  await checkReply(interruptedReply + 1);
}

async function main() {
  assert.ok(existsSync(path.join(extension, 'manifest.json')), 'Build the Chrome extension with pnpm build first.');
  const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || playwright);
  const server = createServer(serveFixture);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const executablePath = process.env.CHROME_EXECUTABLE_PATH;
    for (const hasExistingTurn of [false, true]) {
      const theme = hasExistingTurn ? 'dark' : 'light';
      const context = await chromium.launchPersistentContext('', {
        ...(executablePath ? { executablePath } : { channel: 'chromium' }),
        headless: !process.argv.includes('--headed'),
        colorScheme: theme,
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
      });
      try {
        await verifyComposer(context, origin, hasExistingTurn, theme);
        console.log(`PASS (${process.platform}): ${hasExistingTurn ? 'existing' : 'new'} chat recovers after a disconnected send`);
      } finally {
        await context.close();
      }
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
