# Bundle adb + scrcpy (Windows) into src-tauri/bin/windows/
# Run on a Windows machine:
#   powershell -ExecutionPolicy Bypass -File scripts/bundle-binaries.ps1
#
# NOTE: all messages are ASCII-only to avoid encoding issues
# (Windows PowerShell reads BOM-less UTF-8 as ANSI, which breaks Chinese text).
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root "src-tauri\bin\windows"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# 1. Download scrcpy-win64, pinned to v4.1 (the version validated on macOS):
#    - v3.3.4 (previous pin) has touch coordinate mapping issues on Windows,
#      where clicks on small in-game buttons miss while big launcher targets work;
#    - v4.0 migrated SDL2 -> SDL3 and fixed several position/rotation/size bugs;
#    - v4.1 is proven to work with the app's args (ANDROID_SERIAL, --video-bit-rate,
#      --stay-awake, --record, --no-playback) on the macOS side.
Write-Host "Querying scrcpy-win64 v4.1 ..."
$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/Genymobile/scrcpy/releases"
$release = $releases | Where-Object { $_.tag_name -eq "v4.1" } | Select-Object -First 1
if (-not $release) { throw "scrcpy v4.1 release not found" }
$asset = $release.assets | Where-Object { $_.name -match "scrcpy-win64.*\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "scrcpy-win64 zip asset not found for v4.1" }

$tmpZip = Join-Path $env:TEMP "scrcpy-win64.zip"
Write-Host "Downloading v4.1 / $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmpZip

$extract = Join-Path $env:TEMP "scrcpy-win64"
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $tmpZip -DestinationPath $extract

# The zip may contain a subdirectory; locate the folder with scrcpy.exe
$scrcpyDir = Get-ChildItem -Path $extract -Recurse -Filter "scrcpy.exe" |
    Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
if (-not $scrcpyDir) { throw "scrcpy.exe not found after extract" }
Copy-Item -Path (Join-Path $scrcpyDir "*") -Destination $Dest -Recurse -Force
Write-Host "scrcpy copied (with dlls and scrcpy-server)"

# 2. Ensure adb.exe exists (scrcpy-win64 usually bundles it)
$adb = Join-Path $Dest "adb.exe"
if (-not (Test-Path $adb)) {
    Write-Host "Downloading Android platform-tools (adb.exe) ..."
    $ptZip = Join-Path $env:TEMP "platform-tools.zip"
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $ptZip
    $ptDir = Join-Path $env:TEMP "platform-tools"
    if (Test-Path $ptDir) { Remove-Item -Recurse -Force $ptDir }
    Expand-Archive -Path $ptZip -DestinationPath $ptDir
    Copy-Item -Path (Join-Path $ptDir "platform-tools\adb.exe") -Destination $adb -Force
    Write-Host "adb.exe copied"
}

Write-Host "Done: $Dest"
