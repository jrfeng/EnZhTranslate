# debug/ —— 本地调试脚本

这里的脚本只做一件事：**构建 debug 版并直接运行本地测试**。
不复制、不安装、不生成安装包。

正式安装包用仓库根目录的 `build-win.cmd` / `build-macos.sh` / `build-linux.sh`，产物进 `build/`。

---

## run-win-debug.cmd（Windows）

```
双击运行，或者在命令行里执行：

    debug\run-win-debug.cmd
```

**做什么**

1. 检查 `node` / `cargo`，缺了直接提示退出
2. 没有 `node_modules` 时先 `npm install`
3. `npm run build` 构建前端（esbuild → `dist/`）
4. `cargo build` 构建 debug 版 exe（增量编译，改前端时几乎瞬时）
5. 如果检测到**正在运行的** `fish-translate.exe` 或 `FishTranslateTest.exe`，会先问一句
   `Close the running instance(s)? [y/N]`，回 `y` 才继续（回别的就中止，什么都不做）
6. **直接运行** `src-tauri\target\debug\fish-translate.exe`
7. 脚本窗口保持等待：应用关掉之后才继续，打印退出码，有 panic 日志就一并打印

**为什么第 5 步要问**

所有实例共用同一个应用标识和单实例锁。已经在跑的那个会被新实例顶掉，
所以必须关掉一个——脚本把决定权留给你，避免误杀正在用的窗口。

**注意**

- 脚本窗口**不要提前关**：debug 版的日志和 panic 都打在同一个控制台
- 关闭应用窗口后脚本会停住等你按键（方便看退出码），按任意键结束
- 用到的路径都是构建产物，**不往 `%LOCALAPPDATA%` 写任何东西**

---

## run-macos-debug.sh（macOS）

```
chmod +x debug/run-macos-debug.sh      # 首次需要
./debug/run-macos-debug.sh             # 构建 + 启动，脚本留在前台等应用退出
./debug/run-macos-debug.sh --open      # 构建后用 Finder 打开（脚本不等待）
./debug/run-macos-debug.sh --help      # 看帮助
```

**做什么**

1. 校验系统是 macOS、`node` / `cargo` 可用
2. 没有 `node_modules` 时先 `npm install`
3. `npm run build` 构建前端
4. `npx tauri build --debug --bundles app` 构建 debug `.app`
5. 用 `pgrep -x fish-translate` 检测正在运行的实例，有的话问
   `Close the running instance(s)? [y/N]`，回 `y` 才 `pkill` 掉，其它回答直接中止
6. **直接运行**产物里的可执行文件（`.../bundle/macos/*.app/Contents/MacOS/fish-translate`），
   日志打在同一个终端
7. 应用退出后打印退出码，有 panic 日志就打印，最后等你按回车

**注意**

- 只有 `--open` 模式不等待（Finder 托管），其它模式脚本一直占着终端，方便看日志
- 不往 `~/Applications` 或 `/Applications` 复制任何东西
- 未签名；如果首次打开被 Gatekeeper 拦，右键「打开」即可

---

## 什么时候用这里的脚本

| 场景 | 用哪个 |
|---|---|
| 改了界面/逻辑，想在本机快速看效果并直接运行 | `run-win-debug.cmd`（Windows） / `run-macos-debug.sh`（macOS） |
| 要看 Rust 侧日志、排查 panic | 同上，debug 版会保留控制台 |
| 要安装包 / 发版 | 根目录的 `build-*.cmd/sh`，产物进 `build/` |

## 一个环境限制（只影响 DSH 沙箱）

如果**在 DeepSeek Harness 的 workspace 目录里**运行这些脚本，WebView2 起不来：

```
Failed to setup app: runtime error: failed to create webview:
WebView2 error: WindowsError(Error { code: HRESULT(0x800700AA),
message: "请求的资源在使用中。" })
```

原因是 DSH 对 workspace 做了 ACL 限制。**在普通检出的仓库目录里运行不受影响**——
如果你确实要在 DSH 里测，把 `src-tauri\target\debug\fish-translate.exe` 复制到
`%LOCALAPPDATA%` 下的任意目录再手动运行即可。

## 编码与换行

- `*.cmd` 用 CRLF，`*.sh` 用 LF（见仓库根目录 `.gitattributes`）
- Windows 脚本内容保持纯 ASCII，避免 `cmd.exe` 按 GBK 解析导致中文路径乱码
