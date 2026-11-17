#!/usr/bin/env bash
#
# macOS 测试版（debug）构建：在本地打一个带 Info.plist 的 .app 用于试界面。
#
#   ./debug/build-macos-debug.sh          构建 debug .app
#   ./debug/build-macos-debug.sh --open   构建完直接打开
#
# 与正式版的区别：debug 版有调试符号、体积大、启动慢，控制台能看到日志。
#

set -euo pipefail

cd "$(dirname "$0")/.."

OPEN=0
for arg in "$@"; do
  case "$arg" in
    --open) OPEN=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（可用：--open / --help）" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m错误：%s\033[0m\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "这个脚本只能在 macOS 上跑"

command -v node  >/dev/null 2>&1 || fail "没找到 Node.js：https://nodejs.org"
command -v cargo >/dev/null 2>&1 || fail "没找到 Rust：
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    source \"\$HOME/.cargo/env\""

[ -d node_modules ] || { say "安装前端依赖"; npm install --no-audit --no-fund; }

say "构建前端"
npm run build

say "构建 debug .app"
npx tauri build --debug --bundles app

APP="src-tauri/target/debug/bundle/macos/EnZhTranslate.app"
[ -d "$APP" ] || fail "没找到产物：$APP"

say "完成"
echo "    $APP"
echo "    启动：open \"$APP\""

if [ "$OPEN" -eq 1 ]; then
  open "$APP"
fi
