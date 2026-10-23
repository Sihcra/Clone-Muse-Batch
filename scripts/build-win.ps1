# Build MuseBatch Studio thành bộ cài .exe (NSIS) trên Windows.
# Cách dùng (PowerShell, đứng ở thư mục dự án):
#   powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Chưa có Node.js. Tải bản LTS tại https://nodejs.org, cài xong mở lại PowerShell rồi chạy lại.'
  exit 1
}

$bin = Join-Path (Get-Location) 'resources\bin'
foreach ($f in 'ffmpeg.exe', 'ffprobe.exe') {
  if (-not (Test-Path (Join-Path $bin $f))) {
    Write-Host "Thiếu $f trong resources\bin. Chép ffmpeg.exe, ffprobe.exe và các file .dll của ffmpeg vào đó rồi chạy lại."
    exit 1
  }
}
if (-not (Get-ChildItem $bin -Filter '*.dll')) {
  Write-Host 'Thiếu các file .dll của ffmpeg trong resources\bin. Chép vào đó rồi chạy lại.'
  exit 1
}

npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run dist
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host 'Xong. Bộ cài nằm trong thư mục dist (file "MuseBatch Studio Setup ... .exe").'
Start-Process dist
