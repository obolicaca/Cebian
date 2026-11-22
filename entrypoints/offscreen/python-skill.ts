import type { PythonSkillPackageRequest, PythonSkillPackageResponse, PythonSkillRunRequest, PythonSkillRunResponse } from '@/lib/tools/python-skill-protocol';

export function packageSkillInPython(request: PythonSkillPackageRequest): Promise<PythonSkillPackageResponse> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    const finish = (result: PythonSkillPackageResponse) => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      frame.remove();
      resolve(result);
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== 'null' || event.source !== frame.contentWindow || event.data?.type !== 'python-skill:result') return;
      if (event.data.bytes instanceof Uint8Array && event.data.bytes.byteLength <= 512 * 1024) {
        finish({ bytes: Array.from(event.data.bytes) });
      } else {
        finish({ error: typeof event.data.error === 'string' ? event.data.error : 'Invalid Python ZIP output' });
      }
    };
    const timeout = setTimeout(() => finish({ error: 'Python packaging timed out' }), 45000);
    frame.hidden = true;
    frame.src = chrome.runtime.getURL('python-skill.html');
    frame.onload = () => frame.contentWindow?.postMessage(request, '*');
    window.addEventListener('message', receive);
    document.body.append(frame);
  });
}

const pythonRuns = new Map<string, () => void>();

export function cancelPythonSkill(id: string): void {
  pythonRuns.get(id)?.();
}

export function runPythonSkill(request: PythonSkillRunRequest): Promise<PythonSkillRunResponse> {
  return new Promise((resolve) => {
    if (pythonRuns.has(request.id)) {
      resolve({ error: 'Duplicate Python run' });
      return;
    }
    const frame = document.createElement('iframe');
    const finish = (result: PythonSkillRunResponse) => {
      clearTimeout(timeout);
      pythonRuns.delete(request.id);
      window.removeEventListener('message', receive);
      frame.remove();
      resolve(result);
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== 'null' || event.source !== frame.contentWindow || event.data?.type !== 'python-skill:result') return;
      const value = event.data.result;
      if (typeof value?.error === 'string') {
        finish({ error: value.error.slice(0, 8192) });
      } else if (
        typeof value?.resultJson === 'string' && value.resultJson.length <= 32768 &&
        typeof value.stdout === 'string' && value.stdout.length <= 8192 &&
        typeof value.stderr === 'string' && value.stderr.length <= 8192
      ) {
        finish({ resultJson: value.resultJson, stdout: value.stdout, stderr: value.stderr });
      } else {
        finish({ error: 'Invalid Python sandbox response' });
      }
    };
    const timeout = setTimeout(() => finish({ error: 'Python execution timed out' }), 15000);
    pythonRuns.set(request.id, () => finish({ error: 'Python execution cancelled' }));
    frame.hidden = true;
    frame.sandbox.add('allow-scripts');
    frame.src = chrome.runtime.getURL('python-run.html');
    frame.onload = () => frame.contentWindow?.postMessage(request, '*');
    window.addEventListener('message', receive);
    document.body.append(frame);
  });
}
