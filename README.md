# 英译中 · EnZhTranslate

![version](https://img.shields.io/badge/version-0.6.2-blue)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![stack](https://img.shields.io/badge/Tauri%202-Rust%20%2B%20Web%20Awesome-informational)

一款面向开发者的英文转中文翻译工具。针对技术文本做了结构整理：把原文重排为 Markdown 再翻译，保留代码、命令、路径等术语的原始形态，输出可直接粘贴进文档。

翻译、图片识别、余额查询全部在本机发起，API Key 只保存在本机，不经过任何中间服务器。

---

## 界面

| 浅色 | 深色 |
|:---:|:---:|
| ![浅色主题](docs/screenshots/theme-light.png) | ![深色主题](docs/screenshots/theme-dark.png) |

**风格化**（2px 黑描边、硬阴影、黄黑配色）

![风格化主题](docs/screenshots/theme-bold.png)

> 截图使用模拟数据展示界面，不代表真实接口返回。

---

## 功能特性

### 翻译

- 双栏布局：左侧英文输入、右侧中文译文，译文以 Markdown 渲染，可切换回源码视图
- 两侧都带 Markdown 语法高亮（标题、列表、引用、代码块、链接）
- 支持「粘贴后翻译」：粘贴即自动翻译；也可 `Ctrl/Cmd + Enter` 手动触发
- 相同文本 + 相同术语 + 相同模型不会重复请求，避免浪费额度
- 修改原文、术语或模型后，旧译文标记为「需重新翻译」

### 术语表

- 三段式添加：`术语` → `翻译成` → `译法`，逐条生效于后续翻译
- 条目内原文与译文分别用浅色小块区分，可单条删除
- 一键清空（二次确认），配置随应用持久化

### 图片翻译

- 支持粘贴截图或从本地选择图片，调用 DeepSeek OCR 接口识别文字后填入输入框
- 识别完成可对同一张图片「刷新」重识别，识别中图标旋转并显示实时耗时
- 识别结果可在「校验」弹窗中核对：上半部分图片支持滚轮缩放、拖拽平移、双击还原，下半部分文本支持 预览 / 编辑 切换，确认后才写回输入框

### 界面

- 三套内置主题：浅色、深色、风格化，另有「跟随系统」实时跟随系统深浅色
- 自定义无边框窗口与标题栏，与主题配色统一
- 输出区顶部有细扫光进度指示，替代传统进度条
- 未配置 API Key 时，「设置」按钮显示小红点提示

### 可靠性

- 所有错误提示均为中文，按官方错误码映射，不暴露英文原文
- 错误通过右上角 Toast（自动消失）+ 行内状态双通道提示
- 单实例运行：重复启动只会唤起已有窗口
- Rust 侧 panic 与前端异常均会落盘 / 在界面提示，便于排查

---

## 快速开始

### 下载安装

| 产物 | 大小 | 适用场景 |
|---|---|---|
| `EnZhTranslate_0.6.2_x64-setup.exe` | 2.03 MB | 推荐。自动检测并安装 WebView2，带开始菜单项与卸载入口 |
| `EnZhTranslate.exe`（免安装） | 约 7 MB | 直接分发单文件，目标机器需已安装 WebView2 |

安装后位于 `%LOCALAPPDATA%\Programs\EnZhTranslate\`。

> 产物未做代码签名，首次运行会触发 SmartScreen 提示，选择「更多信息 → 仍要运行」即可。

### 首次配置

打开应用 → 点击「设置」→ 填写 API Key 与接口地址（默认 `https://api.deepseek.com`）→ 点击「保存并读取模型」。

模型列表来自 `/models`，读取成功后出现在顶部下拉框中。

---

## 接口依赖

| 能力 | 接口 | 说明 |
|---|---|---|
| 翻译 | `POST /chat/completions` | OpenAI 兼容格式，兼容第三方服务 |
| 模型列表 | `GET /models` | 用于填充模型下拉框 |
| 余额 | `GET /user/balance` | DeepSeek 专有；不可用时自动隐藏 |
| 图片 OCR | `POST /v1/tools/ocr` | DeepSeek 专有，`multipart/form-data`，按页计费 |

**接口地址不是 DeepSeek 官方域名时，图片翻译能力会整体关闭**（按钮隐藏、粘贴拦截、调用兜底），因为 OCR 接口只在 DeepSeek 官方提供。翻译与余额功能不受影响。

余额低于 3 元显示橙色，低于 2 元显示红色。

---

## 构建

### 环境要求

| 平台 | 依赖 |
|---|---|
| Windows | Node.js、Rust（stable，`x86_64-pc-windows-msvc`）、MSVC Build Tools、Windows SDK |
| macOS | Node.js、Rust、Xcode Command Line Tools（`xcode-select --install`） |

前端使用 **Web Awesome + esbuild** 打包，构建分两步：

```bash
npm install          # 安装 Web Awesome、esbuild、Tauri CLI
npm run build        # esbuild 把 src/ 打包成 dist/
```

### Windows

```powershell
# 只出 exe（需先执行 npm run build）
cd src-tauri
cargo build --release

# 出 exe + NSIS 安装包（自动执行 npm run build）
npx tauri build
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。首次构建会下载 NSIS，需要联网。

一键脚本：`编译.cmd`（正式版）、`测试版.cmd`（debug 版）。

### macOS

```bash
chmod +x build-macos.sh
./build-macos.sh
```

| 参数 | 作用 |
|---|---|
| （无） | 构建当前架构（Apple Silicon → arm64，Intel → x86_64） |
| `--universal` | 同时支持 Intel + Apple Silicon（体积翻倍） |
| `--app-only` | 只生成 `.app`，跳过 `.dmg` |
| `--help` | 显示用法 |

产物位于 `src-tauri/target/release/bundle/macos/` 与 `.../dmg/`。macOS 专属打包配置在 `src-tauri/tauri.macos.conf.json`，Tauri 仅在 macOS 构建时合并。

未签名应用首次打开会被 Gatekeeper 拦截：右键 →「打开」，或执行

```bash
xattr -dr com.apple.quarantine /Applications/EnZhTranslate.app
```

### 开发流程

项目遵循「先测试版、后正式版」：

1. 运行 `测试版.cmd`：构建 debug 版并安装到 `%LOCALAPPDATA%\Programs\EnZhTranslateTest\`，先验证效果
2. 确认无误后，再用 `编译.cmd` 或 `npx tauri build` 出正式产物

测试版与正式版共用同一个单实例锁，切换前请先关闭另一个。

---

## 技术说明

### 架构

前端是纯静态页面，构建时嵌入 Rust 二进制；运行时通过 Tauri IPC 调用本机 Rust 命令，由 Rust 直连模型服务。因此**运行不需要 Node，也不需要浏览器**。

```
WebView2 (前端页面)
      │  __TAURI__.core.invoke
      ▼
Rust 命令层（translate / models / balance / ocr）
      │  reqwest
      ▼
模型服务 API
```

### 主题系统

界面组件基于 Web Awesome（`wa-button` / `wa-input` / `wa-select` / `wa-dialog` / `wa-tag`），其余视觉元素（输入高亮、卡片、开关胶囊、进度扫光、校验弹窗）均为手写 CSS。

三套主题在 `src/app.css` 顶部各定义一组 `--app-*` 变量（底色、面板、边框、强调色、圆角、描边宽度、阴影、字重），配合覆盖 Web Awesome 的 `--wa-*` 令牌即可整体换肤。「跟随系统」读取 `prefers-color-scheme`，在浅色与深色之间切换。

### 项目结构

```
src/                     前端源码
  index.html             页面结构
  app.css                主题变量 + 布局 + Markdown 样式
  app.js                 业务逻辑与渲染
  main.js                注册 Web Awesome 组件后引入 app.js
scripts/build.mjs        esbuild 打包，拷贝 html/css/主题样式到 dist/
dist/                    构建产物（git 忽略，编译进 exe）
src-tauri/
  src/lib.rs             translate / models / balance / ocr 四个命令
  src/main.rs            程序入口
  tauri.conf.json        窗口、bundle、NSIS 图标等配置
  tauri.macos.conf.json  macOS 专属打包配置
  capabilities/          窗口权限声明
  icons/                 图标资源（PNG / ICO / ICNS）
docs/screenshots/        README 截图
icon-src.png             图标源文件（1024×1024）
icon-gen.py              生成图标源图
icon-sizes.py            生成各尺寸 PNG 与 ICO
icon-icns.py             生成 macOS ICNS
build-macos.sh           macOS 一键构建
编译.cmd / 测试版.cmd     Windows 一键构建（正式 / 测试）
```

---

## 注意事项

**不要在 DSH 工作区目录内运行 exe。** 工作区目录的 ACL 被沙箱修改过，WebView2 在其中启动会崩溃：

```
Failed to setup app: runtime error: failed to create webview:
WebView2 error: WindowsError(HRESULT(0x8000FFFF) "灾难性故障")
```

将 exe 复制到工作区外（如 `%LOCALAPPDATA%\Programs\EnZhTranslate\`）即可正常运行。源码放在工作区内没有问题，仅运行位置受限。

---

## 许可

未附带开源许可证，默认保留所有权利。如需用于商业场景或二次分发，请联系作者。
