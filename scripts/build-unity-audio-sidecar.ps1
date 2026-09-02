# Build the Unity audio extractor sidecar on Windows x64.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Python = if ($env:UNITY_AUDIO_PYTHON) { $env:UNITY_AUDIO_PYTHON } else { "python" }
$Dest = Join-Path $Root "src-tauri\bin\windows"
$Build = Join-Path $Root "extractor\.sidecar-build"

& $Python -c "import UnityPy"
if ($LASTEXITCODE -ne 0) { throw "UnityPy is unavailable. Install extractor/requirements.lock first." }
& $Python -m PyInstaller --version
if ($LASTEXITCODE -ne 0) { throw "PyInstaller is unavailable. Install extractor/packaging-requirements.txt first." }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
if (Test-Path $Build) { Remove-Item -Recurse -Force $Build }
New-Item -ItemType Directory -Force -Path (Join-Path $Build "dist"), (Join-Path $Build "work"), (Join-Path $Build "spec") | Out-Null
$env:PYINSTALLER_CONFIG_DIR = Join-Path $Build "cache"
New-Item -ItemType Directory -Force -Path $env:PYINSTALLER_CONFIG_DIR | Out-Null

& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name unity-audio-extractor `
  --paths (Join-Path $Root "extractor\src") `
  --distpath (Join-Path $Build "dist") `
  --workpath (Join-Path $Build "work") `
  --specpath (Join-Path $Build "spec") `
  --collect-all UnityPy `
  --collect-all archspec `
  --collect-all astc_encoder `
  --collect-all etcpak `
  --collect-all fmod_toolkit `
  --collect-all lz4 `
  --collect-all texture2ddecoder `
  (Join-Path $Root "extractor\sidecar_entry.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }

Copy-Item (Join-Path $Build "dist\unity-audio-extractor.exe") (Join-Path $Dest "unity-audio-extractor.exe") -Force
& (Join-Path $Dest "unity-audio-extractor.exe") --version
Write-Host "Built Windows sidecar: $(Join-Path $Dest 'unity-audio-extractor.exe')"
