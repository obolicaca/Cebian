import { ensureOffscreen } from './offscreen';
import type { PythonSkillRunRequest, PythonSkillRunResponse } from './python-skill-protocol';

export async function executePythonSkill(code: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const argsJson = JSON.stringify(args);
  if (argsJson.length > 65536) throw new Error('Python arguments exceed the input limit');
  if (code.length > 131072) throw new Error('Python script exceeds the input limit');
  await ensureOffscreen();
  signal?.throwIfAborted();

  const request: PythonSkillRunRequest = { type: 'python-skill:run', id: crypto.randomUUID(), code, argsJson };
  const abort = () => { void chrome.runtime.sendMessage({ type: 'python-skill:cancel', id: request.id }).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response: PythonSkillRunResponse | undefined = await chrome.runtime.sendMessage(request);
    signal?.throwIfAborted();
    if (!response || 'error' in response) throw new Error(response?.error ?? 'Python sandbox did not respond');
    return { result: JSON.parse(response.resultJson), stdout: response.stdout, stderr: response.stderr };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
