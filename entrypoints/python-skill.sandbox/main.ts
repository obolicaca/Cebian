import type { PythonSnapshotPage } from '@/lib/tools/python-skill-protocol';
import packageSkill from './package-skill.py?raw';

interface PythonRuntime {
  globals: { set(name: string, value: string): void };
  runPython(code: string): { toJs(): Uint8Array; destroy(): void };
}

declare function loadPyodide(options: { indexURL: string }): Promise<PythonRuntime>;

window.addEventListener('message', async (event) => {
  const origin = 'chrome-extension://' + location.host;
  if (event.source !== parent || event.origin !== origin || event.data?.type !== 'python-skill:package') return;

  try {
    const indexURL = new URL('./pyodide/', location.href).href;
    await new Promise<void>((resolve, reject) => {
      const loader = document.createElement('script');
      loader.src = indexURL + 'pyodide.js';
      loader.onload = () => resolve();
      loader.onerror = () => reject(new Error('Bundled Pyodide runtime is unavailable'));
      document.head.append(loader);
    });
    const python = await loadPyodide({ indexURL });
    python.globals.set('pages_json', JSON.stringify(event.data.pages as PythonSnapshotPage[]));
    python.globals.set('name_json', JSON.stringify(event.data.name));
    const output = python.runPython(packageSkill);
    try {
      parent.postMessage({ type: 'python-skill:result', bytes: output.toJs() }, origin);
    } finally {
      output.destroy();
    }
  } catch (error) {
    parent.postMessage({ type: 'python-skill:result', error: String(error) }, origin);
  }
}, { once: true });
