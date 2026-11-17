#!/usr/bin/env bash
#
# 在 macOS 上构建「英译中」：
#   ./build-macos.sh              构建当前架构的 .app + .dmg（Apple Silicon 或 Intel）
#   ./build-macos.sh --universal  构建同时支持 Intel + Apple Silicon 的通用包
#   ./build-macos.sh --app-only   只生成 .app，不生成 .dmg
#
# 需要：Xcode 命令行工具、Rust、Node.js
#

set -euo pipefail

cd "$(dirname "$0")"

UNIVERSAL=0
BUNDLES_ONLY_APP=0
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --app-only) BUNDLES_ONLY_APP=1 ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$arg（可用：--universal / --app-only / --help）" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m错误：%s\033[0m\n' "$1" >&2; exit 1; }

say "检查构建环境"
echo "    架构：$(uname -m)  ·  macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"

command -v node >/dev/null 2>&1 || fail "没找到 Node.js，先装：https://nodejs.org"
command -v npm  >/dev/null 2>&1 || fail "没找到 npm"
command -v cargo >/dev/null 2>&1 || fail "没找到 Rust，先装：
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    source \"\$HOME/.cargo/env\""
xcode-select -p >/dev/null 2>&1 && XCODE_OK=1 || XCODE_OK=0
if [ "$XCODE_OK" -eq 0 ]; then
  echo "    没找到 Xcode 命令行工具，是否现在安装？(y/n)"
  read -r answer
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    xcode-select --install || true
    fail "装完后重新运行本脚本。"
  fi
  fail "需要 Xcode 命令行工具：xcode-select --install"
fi

say "安装前端依赖"
npm install --no-audit --no-fund

say "构建前端（esbuild）"
npm run build

if [ "$UNIVERSAL" -eq 1 ]; then
  say "准备通用构建（Intel + Apple Silicon）"
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
fi

if [ "$BUNDLES_ONLY_APP" -eq 1 ]; then
  say "打包 .app"
  if [ "$UNIVERSAL" -eq 1 ]; then
    npx tauri build --target universal-apple-darwin --bundles app
  else
    npx tauri build --bundles app
  fi
else
  say "打包 .app + .dmg"
  if [ "$UNIVERSAL" -eq 1 ]; then
    npx tauri build --target universal-apple-darwin
  else
    npx tauri build
  fi
fi

BUNDLE_DIR="src-tauri/target/release/bundle"
if [ "$UNIVERSAL" -eq 1 ]; then
  BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
fi

say "产物"
find "$BUNDLE_DIR" -maxdepth 2 \( -name '*.app' -o -name '*.dmg' \) 2>/dev/null | while read -r item; do
  echo "    $item  ($(du -sh "$item" | cut -f1))"
done

# 统一收集到仓库根目录的 build/（已在 .gitignore 中排除）
mkdir -p build
find "$BUNDLE_DIR" -maxdepth 2 \( -name '*.dmg' \) -exec cp -Rf {} build/ \; 2>/dev/null
echo "    dmg 已复制到 ./build/"

cat <<'TIP'

提示
  · 首次打开未签名的 .app 会被 Gatekeeper 拦下：右键 →「打开」，或
      xattr -dr com.apple.quarantine /Applications/EnZhTranslate.app
  · 想把 .app 拖进「应用程序」，直接打开 dmg 拖过去即可
  · 本机自用不需要开发者签名；要分发给别人得用 Apple Developer 证书签名+公证
TIP
