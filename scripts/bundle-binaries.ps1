# 打包内置的 adb + scrcpy（Windows）到 src-tauri/bin/windows/
# 在 Windows 机器上运行：
#   powershell -ExecutionPolicy Bypass -File scripts/bundle-binaries.ps1
#
# 注意：本脚本未在真机验证，使用前请确认能正常联网下载 GitHub / dl.google.com。
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root "src-tauri\bin\windows"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# 1. 下载最新 scrcpy-win64
Write-Host "查询最新 scrcpy-win64 ..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/Genymobile/scrcpy/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match "scrcpy-win64.*\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "未找到 scrcpy-win64 下载资源" }

$tmpZip = Join-Path $env:TEMP "scrcpy-win64.zip"
Write-Host "下载 $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmpZip

$extract = Join-Path $env:TEMP "scrcpy-win64"
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $tmpZip -DestinationPath $extract

# 解压后可能有一层子目录，定位 scrcpy.exe 所在目录
$scrcpyDir = Get-ChildItem -Path $extract -Recurse -Filter "scrcpy.exe" |
    Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
if (-not $scrcpyDir) { throw "解压后未找到 scrcpy.exe" }
Copy-Item -Path (Join-Path $scrcpyDir "*") -Destination $Dest -Recurse -Force
Write-Host "已复制 scrcpy（含 dll 与 scrcpy-server）"

# 2. 确保 adb.exe 存在（scrcpy-win64 通常自带；若没有则单独下载 platform-tools）
$adb = Join-Path $Dest "adb.exe"
if (-not (Test-Path $adb)) {
    Write-Host "下载 Android platform-tools（adb.exe）..."
    $ptZip = Join-Path $env:TEMP "platform-tools.zip"
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $ptZip
    $ptDir = Join-Path $env:TEMP "platform-tools"
    if (Test-Path $ptDir) { Remove-Item -Recurse -Force $ptDir }
    Expand-Archive -Path $ptZip -DestinationPath $ptDir
    Copy-Item -Path (Join-Path $ptDir "platform-tools\adb.exe") -Destination $adb -Force
    Write-Host "已复制 adb.exe"
}

Write-Host "完成：$Dest"
