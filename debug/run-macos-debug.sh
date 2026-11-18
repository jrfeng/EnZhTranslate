#!/usr/bin/env bash
#
# macOS 一键跑 debug 版：构建 → 检测正在运行的实例 → 启动 → 等待退出
#
#   ./debug/run-macos-debug.sh          构建并启动 debug 版
#   ./debug/run-macos-debug.sh --open   构建后交给 Finder 打开（脚本不等待）
#   ./debug/run-macos-debug.sh --help   看帮助
#
# 和 build-macos-debug.sh 的区别：这个脚本构建完会直接启动，适合手动测试。
#

set -euo pipefail

cd "$(dirname "$0")/.."

OPEN_VIA_FINDER=0
for arg in "$@"; do
  case "$arg" in
    --open) OPEN_VIA_FINDER=1 ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (use --open / --help)" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

say "FishTranslate debug runner"

[ "$(uname -s)" = "Darwin" ] || fail "This script only runs on macOS."

command -v node  >/dev/null 2>&1 || fail "Node.js not found: https://nodejs.org"
command -v cargo >/dev/null 2>&1 || fail "cargo not found. Install Rust first:
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    source \"\$HOME/.cargo/env\""

if [ ! -d node_modules ]; then
  say "Installing frontend dependencies"
  npm install --no-audit --no-fund
fi

say "[1/3] Building frontend"
npm run build

say "[2/3] Building debug .app"
npx tauri build --debug --bundles app

APP=$(find src-tauri/target/debug/bundle/macos -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)
[ -n "$APP" ] && [ -d "$APP" ] || fail "Debug .app not found under src-tauri/target/debug/bundle/macos"

# ---- 正在运行的实例会抢单实例锁，先问一句 ----
running="$(pgrep -x fish-translate 2>/dev/null || true)"
if [ -n "$running" ]; then
  say "A FishTranslate instance is already running"
  echo "    pid: $running"
  echo "    Both the release build and the test build share one single-instance lock,"
  echo "    so one of them has to be closed."
  echo
  printf '  Close the running instance(s)? [y/N] '
  read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES)
      pkill -x fish-translate 2>/dev/null || true
      sleep 1
      ;;
    *)
      echo
      echo "  Cancelled. Nothing was started."
      exit 1
      ;;
  esac
fi

DEST="$HOME/Applications/FishTranslateTest.app"
say "[3/3] Installing to $DEST"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$APP" "$DEST"

BIN="$DEST/Contents/MacOS/fish-translate"
[ -x "$BIN" ] || fail "Executable not found inside the app bundle: $BIN"

if [ "$OPEN_VIA_FINDER" -eq 1 ]; then
  open "$DEST"
  echo "  Opened via Finder. The script does not wait in this mode."
  exit 0
fi

echo
echo "  ------------------------------------------------------------"
echo "   Running the debug build in this terminal:"
echo "   logs and panics appear below. Close the app window to stop."
echo "  ------------------------------------------------------------"
echo

PANIC_LOG="${TMPDIR:-/tmp}fish-translate-panic.log"
rm -f "$PANIC_LOG"

set +e
"$BIN"
code=$?
set -e

echo
echo "  App exited with code $code"
if [ -f "$PANIC_LOG" ]; then
  echo "  --- panic log ---"
  cat "$PANIC_LOG"
  echo "  -----------------"
fi
echo

read -r -p "Press Enter to close this window ... " _ || true
