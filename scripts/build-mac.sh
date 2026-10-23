#!/usr/bin/env bash
# Build MuseBatch Studio thành file .dmg trên macOS, tự cài Node.js và ffmpeg nếu thiếu.
# Cách dùng (Terminal, đứng ở thư mục dự án): bash scripts/build-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname)" = "Darwin" ] || { echo "Script này chỉ chạy trên macOS."; exit 1; }

if ! command -v brew >/dev/null 2>&1; then
  echo "Chưa có Homebrew. Cài theo hướng dẫn ở https://brew.sh rồi chạy lại lệnh này."
  exit 1
fi

# Apple silicon: brew nằm ở /opt/homebrew, Terminal mới có thể chưa có trong PATH
eval "$(brew shellenv)"

command -v node >/dev/null 2>&1 || brew install node
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg # ffprobe đi kèm ffmpeg

npm install
npm run dist:mac

echo
echo "Xong. File .dmg nằm trong thư mục dist/ (mở bằng Finder)."
open dist
