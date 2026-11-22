self.onmessage = async ({ data }) => {
  try {
    importScripts(data.indexURL + 'pyodide.js');
    const python = await loadPyodide({ indexURL: data.indexURL });
    let stdout = '';
    let stderr = '';
    python.setStdout({ batched: (line) => { stdout = (stdout + line + '\n').slice(0, 8192); } });
    python.setStderr({ batched: (line) => { stderr = (stderr + line + '\n').slice(0, 8192); } });
    python.globals.set('_cebian_args_json', data.argsJson);
    python.runPython('import json as _cebian_json\nargs = _cebian_json.loads(_cebian_args_json)\nresult = None');
    await python.runPythonAsync(data.code);
    const resultJson = python.runPython('import json as _cebian_json\n_cebian_json.dumps(result, ensure_ascii=False, allow_nan=False)');
    if (resultJson.length > 32768) throw new Error('Python result exceeds the output limit');
    self.postMessage({ resultJson, stdout, stderr });
  } catch (error) {
    self.postMessage({ error: String(error).slice(0, 8192) });
  }
};
