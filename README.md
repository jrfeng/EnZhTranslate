# 英译中 · Tauri 桌面版

版本 0.6.0 · 三套内置主题（Web Awesome）+ 图片 OCR 翻译。原生桌面版：前端静态页打进程序里，Rust 侧四个命令直接调模型接口，**运行时不需要 Node，也不需要开浏览器**。

## 功能

- 左栏英文输入（Markdown 语法高亮）、右栏中文译文（Markdown 渲染 / 源码切换）
- 术语面板：`术语` + `翻译成` + `译法` 三段式添加，可逐条删除；条目里的原文/译文各自带浅色小块便于区分；标题行「清空」（警示色，位于「收起」左侧）会在弹窗二次确认后清空全部术语
- 「粘贴后翻译」「自动复制」两个开关做成胶囊样式，开启时填充强调色
- 同样的文本（且术语、模型都没变）不会重复发请求
- 右上角：模型下拉（来自 `/models`）、主题下拉、设置、余额
- **三套主题**：浅色 / 深色 / 风格化（2px 黑描边 + 硬阴影 + 黄黑配色），外加「跟随系统」跟随深浅色自动切换；选择会记住
- **余额显示**：调 `GET /user/balance`（DeepSeek 官方接口），点击可刷新；低于 3 元变橙、低于 2 元变红；接口不支持时自动隐藏
- **设置小红点**：没填 API Key 时「设置」按钮右上角显示红点
- **图片翻译**：粘贴截图或点输入框右下角的「图片」选文件 → 调 DeepSeek OCR（`POST /v1/tools/ocr`）识别文字 → 自动填入输入框（开着「粘贴后翻译」会直接翻译）；识别完成后预览条出现「刷新」图标（OCR 进行中会转圈），可对同一张图重新识别
- **校验弹窗**：点缩略图或「校验」打开大弹窗，上半部分是图片（滚轮缩放、拖拽平移、双击还原、右上角 ✕ 关闭），下半部分是识别文本，支持 预览 / 编辑 切换；点「确认」才写回输入框，有改动时关闭会先确认
- **中文错误提示**：OCR 与翻译的错误都按官方错误表映射成中文，通过右上角 Toast（6 秒自动消失）和行内状态一起提示，不会出现英文原文
- 翻译时输出卡顶部有一条 2px 渐变扫光；改原文/术语/模型后旧译文标「需重新翻译」
- **单实例**：再次双击快捷方式只会把已有窗口唤到前面，不会再开新窗口

## ⚠️ 不要从 DSH 工作区里运行这个 exe

DSH 的工作区目录（`...\deepseek-harness\default-workspace\...`）被沙箱改过 ACL。Chromium/WebView2 在该目录下启动时会崩：

```
Failed to setup app: runtime error: failed to create webview:
WebView2 error: WindowsError(HRESULT(0x8000FFFF) "灾难性故障")
```

同一份 exe 复制到工作区外（例如 `%LOCALAPPDATA%\Programs\EnZhTranslate\`）就正常。事件日志里能看到 `msedgewebview2.exe` 在 `msedge.dll` 里以 `0x80000003` 崩溃——这是 Chromium 内部 `CHECK` 失败（创建 IPC 命名管道/写崩溃转储被拒）。

**结论：源码放工作区没问题，但运行必须在工作区外。** `编译.cmd` 会自动把成品装到 `%LOCALAPPDATA%\Programs\EnZhTranslate\`。

## 分发给别人

两种产物，选一个：

| 产物 | 大小 | 适合 |
|---|---|---|
| `%LOCALAPPDATA%\Programs\EnZhTranslate\EnZhTranslate.exe` | 6.7 MB | 直接发 exe，对方双击即用（需要机器上已有 WebView2） |
| `EnZhTranslate_0.6.0_x64-setup.exe` | 2.01 MB | 发安装包，自动检测/安装 WebView2，带开始菜单与卸载项 |

安装包由 `npx tauri build` 生成，位于 `src-tauri/target/release/bundle/nsis/`。

两个都是**未签名**的，首次运行会弹 SmartScreen：「更多信息」→「仍要运行」。

## 开发流程（先测试版，后正式版）

改完代码后**不要直接打正式包**：

1. 双击 `测试版.cmd` → 构建 debug 版，装到 `%LOCALAPPDATA%\Programs\EnZhTranslateTest\EnZhTranslateTest.exe`，先试效果
   - 跑之前先关掉正式版，两者共用同一个单实例锁
   - debug 版会多一个控制台窗口，属正常
2. 确认没问题后，再双击 `编译.cmd`（出正式 exe）或用 `npx tauri build`（出安装包）

正式版安装位置：`%LOCALAPPDATA%\Programs\EnZhTranslate\`。

## 构建

### Windows

前置：Node.js（前端打包）+ Rust（stable，`x86_64-pc-windows-msvc`）+ MSVC Build Tools + Windows SDK。本机都已就绪。

前端是 **Web Awesome + esbuild 打包**，所以多了一步构建：

```powershell
npm install          # 装 @awesome.me/webawesome、esbuild、@tauri-apps/cli
npm run build        # esbuild 把 src/ 打包成 dist/
```

产物 `dist/`（app.js 约 257 KB，含 lit 与 Web Awesome 组件）。

然后打 exe 或安装包：

```powershell
cd src-tauri
cargo build --release     # 只出 exe（需要先 npm run build）
```

```powershell
npx tauri build           # 出 exe + NSIS 安装包（会自动跑 npm run build）
```

安装包在 `src-tauri/target/release/bundle/nsis/`。首次构建会下载 NSIS，需要联网。

> exe **别在源码目录里双击**，复制到工作区外再运行，或直接双击项目根目录的 `编译.cmd`。

开发模式（改完前端重新打包再启动）：

```powershell
npm run build && npx tauri dev
```

### macOS

前置：**Xcode 命令行工具**（`xcode-select --install`）、Rust、Node.js。

```bash
chmod +x build-macos.sh
./build-macos.sh
```

脚本会自动检查环境、装依赖、打包前端、生成 `.app` 和 `.dmg`，最后打印产物路径。

| 参数 | 作用 |
|---|---|
| （无） | 构建当前架构（Apple Silicon 出 arm64，Intel 出 x86_64） |
| `--universal` | 同时支持 Intel + Apple Silicon（会先 `rustup target add` 两个目标，体积翻倍） |
| `--app-only` | 只生成 `.app`，跳过 `.dmg` |
| `--help` | 显示用法 |

产物在 `src-tauri/target/release/bundle/macos/`（`.app`）和 `.../bundle/dmg/`（`.dmg`）。

macOS 的平台配置单独放在 `src-tauri/tauri.macos.conf.json`（打包目标是 `app` + `dmg`，图标用 `icon.icns`），Tauri 会在 macOS 上自动合并它，Windows 构建不受影响。

未签名的 `.app` 首次打开会被 Gatekeeper 拦下：右键 →「打开」，或

```bash
xattr -dr com.apple.quarantine /Applications/EnZhTranslate.app
```

要分发给别人就得用 Apple Developer 证书签名 + 公证，本机自用不需要。

## 首次使用

打开后点「设置」，填 **API Key** 和 **接口地址**（默认 `https://api.deepseek.com`，OpenAI 兼容地址均可），点「保存并读取模型」，模型列表会进右上角下拉框。

API Key 存在 WebView 的 localStorage 里（按应用隔离），随请求交给本机的 Rust 进程，再由 Rust 直接请求模型接口——不经过任何第三方服务器。

## 主题

界面基于 **Web Awesome**（Shoelace 继任者）的 Web Components：`wa-button` / `wa-input` / `wa-select` / `wa-dialog` / `wa-tag`，只有这几个组件，其余（输入高亮、卡片、开关胶囊、进度扫光）都是手写。

三套主题定义在 `src/app.css` 顶部，各是一组 `--app-*` 变量（底色、面板、边框、强调色、圆角、描边宽度、阴影、字重），再叠一层 Web Awesome 的 `--wa-*` 令牌覆盖：

| 主题 | 特征 |
|---|---|
| 浅色 | 发丝线、系统蓝、极淡阴影 |
| 深色 | 近黑底、紫色强调 |
| 风格化 | 米白底、2px 黑描边、3px 硬阴影、黄色顶栏 |

「跟随系统」不是第四套样式，而是按 `prefers-color-scheme` 在浅色/深色之间切换，系统主题变化时实时跟随。想换主色改 `--app-accent` 即可。

## 结构

```
src/                     前端源码
  index.html             页面结构（wa-* 组件 + 卡片）
  app.css                三套主题变量 + 布局 + Markdown 样式
  app.js                 业务逻辑（调用 __TAURI__.core.invoke）
  main.js                注册 Web Awesome 组件后引入 app.js
scripts/build.mjs        esbuild 打包 + 拷贝 html/css/主题样式到 dist/
dist/                    构建产物（git 忽略，打包进 exe）
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json        窗口 1180x780、frontendDist=../dist、beforeBuildCommand
  tauri.macos.conf.json  macOS 专用：targets=app+dmg、icon.icns
  capabilities/default.json
  icons/                 由 icon-src.png 生成（32/128/256/512 + ico + icns）
  src/main.rs            入口
  src/lib.rs             translate / models / balance / ocr 四个命令
icon-src.png             图标源文件（1024×1024）
icon-gen.py              画图标
icon-sizes.py            生成各尺寸与 .ico
icon-icns.py             生成 macOS 的 .icns
build-macos.sh           macOS 一键构建（.app / .dmg）
编译.cmd                 Windows 一键编译 exe
测试版.cmd               Windows 测试版（debug）构建
```
