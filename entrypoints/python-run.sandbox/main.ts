import workerSource from './worker.js?raw';

window.addEventListener('message', (event) => {
  const origin = 'chrome-extension://' + location.host;
  if (event.source !== parent || event.origin !== origin || event.data?.type !== 'python-skill:run') return;

  const indexURL = new URL('./pyodide/', location.href).href;
  const blob = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(blob);
  const finish = (result: unknown) => {
    worker.terminate();
    URL.revokeObjectURL(blob);
    parent.postMessage({ type: 'python-skill:result', result }, origin);
  };
  worker.onmessage = ({ data }) => finish(data);
  worker.onerror = () => finish({ error: 'Python worker failed to start or execute' });
  worker.postMessage({ indexURL, code: event.data.code, argsJson: event.data.argsJson });
}, { once: true });
