param(
    [string]$Version = "1.73.2"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BinariesDir = Join-Path $ProjectRoot "src-tauri\binaries"
$TempDir = Join-Path $ProjectRoot ".tmp\rclone-download"
$ZipPath = Join-Path $TempDir "rclone.zip"
$ExtractDir = Join-Path $TempDir "extract"

$DownloadUrl = "https://downloads.rclone.org/v$Version/rclone-v$Version-windows-amd64.zip"
$TargetExe = Join-Path $BinariesDir "rclone-x86_64-pc-windows-msvc.exe"

Write-Host "Project root: $ProjectRoot"
Write-Host "Downloading rclone v$Version ..."
Write-Host "URL: $DownloadUrl"

New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}
if (Test-Path $ExtractDir) {
    Remove-Item $ExtractDir -Recurse -Force
}

Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath
Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

$RcloneExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "rclone.exe" | Select-Object -First 1

if (-not $RcloneExe) {
    throw "rclone.exe was not found in the downloaded archive."
}

Copy-Item -Path $RcloneExe.FullName -Destination $TargetExe -Force

Write-Host "Installed:"
Write-Host "  $TargetExe"

# Optional cleanup
Remove-Item $TempDir -Recurse -Force

Write-Host "Done."