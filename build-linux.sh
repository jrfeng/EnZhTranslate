#!/usr/bin/env bash
#
# 在 Linux 上构建「英译中」：
#   ./build-linux.sh              构建 .deb + .AppImage
#   ./build-linux.sh --deb        只构建 .deb
#   ./build-linux.sh --appimage   只构建 .AppImage
#
# 需要：Node.js、Rust、webkit2gtk-4.1 开发包（见下方提示）
#

set -euo pipefail

cd "$(dirname "$0")"

ONLY=""
for arg in "$@"; do
  case "$arg" in
    --deb) ONLY="deb" ;;
    --appimage) ONLY="appimage" ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$arg（可用：--deb / --appimage / --help）" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m错误：%s\033[0m\n' "$1" >&2; exit 1; }

say "检查构建环境"
echo "    发行版：$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo '未知')"

command -v node >/dev/null 2>&1 || fail "没找到 Node.js，先装：https://nodejs.org"
command -v npm  >/dev/null 2>&1 || fail "没找到 npm"
command -v cargo >/dev/null 2>&1 || fail "没找到 Rust，先装：
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    source \"\$HOME/.cargo/env\""

if ! command -v pkg-config >/dev/null 2>&1; then
  fail "没找到 pkg-config。Debian/Ubuntu 可执行：
    sudo apt install -y pkg-config libwebkit2gtk-4.1-dev build-essential curl wget file \\
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf"
fi

if ! pkg-config --exists webkit2gtk-4.1; then
  fail "缺少 WebKitGTK 4.1 开发包（Tauri 2 必需）。Debian/Ubuntu：
    sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \\
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  Fedora：
    sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \\
      librsvg2-devel patchelf
  Arch：
    sudo pacman -S webkit2gtk-4.1 base-devel openssl libappindicator-gtk3 librsvg patchelf"
fi

# 界面是中文的，系统里没有任何中日韩字体时文字会变成方块
if command -v fc-list >/dev/null 2>&1 && [ -z "$(fc-list :lang=zh 2>/dev/null)" ]; then
  echo "    提示：系统缺少中文字体，界面中文会显示成方块。可安装："
  echo "      sudo apt install -y fonts-noto-cjk"
  echo "    没有 sudo 权限时，也可以把字体装到用户目录："
  echo "      apt-get download fonts-noto-cjk && dpkg -x fonts-noto-cjk*.deb /tmp/f && \\"
  echo "        mkdir -p ~/.local/share/fonts && cp /tmp/f/usr/share/fonts/opentype/noto/*.ttc ~/.local/share/fonts/ && fc-cache -f"
fi

say "安装前端依赖"
npm install --no-audit --no-fund

say "构建前端（esbuild）"
npm run build

# 打包 AppImage 时 Tauri 会调用 linuxdeploy（本身也是 AppImage）。
# 系统只有 libfuse3 或没装 FUSE 时会启动失败，改成解压执行模式即可。
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  export APPIMAGE_EXTRACT_AND_RUN=1
  echo "    未检测到 libfuse2，AppImage 打包改用解压执行模式"
fi

if [ -n "$ONLY" ]; then
  say "打包 .$([ "$ONLY" = "deb" ] && echo deb || echo AppImage)"
  npx tauri build --bundles "$ONLY"
else
  say "打包 .deb + .AppImage"
  npx tauri build
fi

BUNDLE_DIR="src-tauri/target/release/bundle"

say "产物"
find "$BUNDLE_DIR" -maxdepth 2 \( -name '*.deb' -o -name '*.AppImage' \) 2>/dev/null | while read -r item; do
  echo "    $item  ($(du -h "$item" | cut -f1))"
done

# 统一收集到仓库根目录的 build/（已在 .gitignore 中排除）
mkdir -p build
for kind in deb appimage; do
  case "$kind" in
    deb) pattern='*.deb' ;;
    appimage) pattern='*.AppImage' ;;
  esac
  newest=$(find "$BUNDLE_DIR/$kind" -maxdepth 1 -name "$pattern" 2>/dev/null | ls -t 2>/dev/null | head -n1 || true)
  if [ -n "$newest" ]; then
    rm -f build/$pattern
    cp -f "$newest" build/
  fi
done
echo "    已复制到 ./build/"
ls -1 build 2>/dev/null | sed 's/^/    /'

cat <<'TIP'

提示
  · .deb 安装：sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
    （缺依赖时用 sudo apt -f install 补齐）
  · .AppImage 直接运行前需加可执行位：chmod +x *.AppImage
    若提示缺少 FUSE，可装 libfuse2，或改用：
      ./Fish翻译_*.AppImage --appimage-extract-and-run
  · 单实例依赖桌面会话的 DBus，在纯 SSH / 无桌面环境下可能不生效
TIP
