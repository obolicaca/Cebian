param(
  [string]$RuntimeDirectory,
  [string]$OutputDirectory = '.output/chrome-mv3'
)

$ErrorActionPreference = 'Stop'
$assets = @('pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'pyodide-lock.json', 'python_stdlib.zip')
if (-not $RuntimeDirectory) { throw 'Pass the extracted pyodide@0.27.7 npm package directory.' }
if (-not (Test-Path (Join-Path $OutputDirectory 'python-skill.html'))) { throw 'Build the Chrome extension first.' }
foreach ($asset in $assets) {
  if (-not (Test-Path (Join-Path $RuntimeDirectory $asset))) { throw "Missing runtime asset: $asset" }
}
$target = New-Item -ItemType Directory -Force (Join-Path $OutputDirectory 'pyodide')
foreach ($asset in $assets) {
  Copy-Item -LiteralPath (Join-Path $RuntimeDirectory $asset) -Destination $target.FullName
}
