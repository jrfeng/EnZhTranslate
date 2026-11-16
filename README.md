# 英译中 · Tauri 桌面版

版本 0.3.0。原生桌面版：前端静态页打进程序里，Rust 侧三个命令直接调模型接口，**运行时不需要 Node，也不需要开浏览器**。

## 功能

- 左栏英文输入（Markdown 语法高亮）、右栏中文译文（Markdown 渲染 / 源码切换）
- 术语面板：`术语` + `翻译成` + `译法` 三段式添加，可逐条删除；标题行「清空」（警示色，位于「收起」左侧）会在弹窗二次确认后清空全部术语
- 「粘贴后翻译」：勾选后粘贴即自动翻译；「翻译」按钮常显
- 同样的文本（且术语、模型都没变）不会重复发请求
- 「自动复制」：翻译成功后自动复制 Markdown 译文
- 右上角模型下拉（来自 `/models`）、设置抽屉（API Key + 接口地址）
- **余额显示**：调 `GET /user/balance`（DeepSeek 官方接口），顶部显示「余额 ¥xx.xx」，点击可刷新；接口不支持时自动隐藏
- 翻译时输出框上方有进度条动画；改原文/术语/模型后旧译文标「需重新翻译」
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
| `EnZhTranslate_0.3.0_x64-setup.exe` | 1.80 MB | 发安装包，自动检测/安装 WebView2，带开始菜单与卸载项 |

安装包由 `npx tauri build` 生成，位于 `src-tauri/target/release/bundle/nsis/`。

两个都是**未签名**的，首次运行会弹 SmartScreen：「更多信息」→「仍要运行」。

## 构建

前置：Rust（stable，`x86_64-pc-windows-msvc`）+ MSVC Build Tools + Windows SDK。本机都已就绪。

```powershell
cd src-tauri
cargo build --release
```

产物：`src-tauri/target/release/en-zh-translate.exe`（单文件）。**别在原地双击**，复制到工作区外再运行，或直接双击项目根目录的 `编译.cmd`。

想要安装包（`.msi` / NSIS 安装程序）再装 Tauri CLI：

```powershell
npm install            # 装 @tauri-apps/cli
npx tauri build        # 产物在 src-tauri/target/release/bundle/
```

首次会下载 NSIS/WiX，需要联网。

开发模式（改完前端立刻看到效果）：

```powershell
npx tauri dev
```

## 首次使用

打开后点「设置」，填 **API Key** 和 **接口地址**（默认 `https://api.deepseek.com`，OpenAI 兼容地址均可），点「保存并读取模型」，模型列表会进右上角下拉框。

API Key 存在 WebView 的 localStorage 里（按应用隔离），随请求交给本机的 Rust 进程，再由 Rust 直接请求模型接口——不经过任何第三方服务器。

## 结构

```
src/                     前端（原样搬过来的，无构建步骤）
  index.html
  app.css
  app.js                 两处 fetch 换成了 __TAURI__.core.invoke
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json        窗口 1180x780、withGlobalTauri、图标
  capabilities/default.json
  icons/                 由 icon-src.png 生成（32/128/256/512 + ico）
  src/main.rs            入口
  src/lib.rs             translate / models 两个命令
icon-src.png             图标源文件（1024×1024）
icon-gen.py              画图标
icon-sizes.py            生成各尺寸与 .ico
```
