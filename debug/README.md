# debug/ —— 测试版构建脚本

这里只放**测试用**的脚本：构建出来的东西给自己验证用，不对外发布。
正式安装包请用仓库根目录的 `build-win.cmd` / `build-macos.sh` / `build-linux.sh`。

---

## build-win-debug.cmd（Windows 测试版）

```
双击运行，或者在命令行里执行：

    debug\build-win-debug.cmd
```

**做什么**

1. 检查 `node` / `cargo` 是否存在，没有就提示并退出
2. 没有 `node_modules` 时先跑 `npm install`
3. `npm run build` 构建前端（esbuild → `dist/`）
4. `cargo build` 构建 **debug** 版 exe（`src-tauri\target\debug\fish-translate.exe`）
5. 复制到 `%LOCALAPPDATA%\Programs\FishTranslateTest\FishTranslateTest.exe`

**注意**

- 跑之前先关掉正式版：两者是同一个应用标识，会抢单实例锁，后启动的会直接退出
- debug 版旁边会**多一个控制台窗口**，panic 和日志都打在那里，这是特性不是 bug
- 测试版**没有安装包**，就是一个 exe，删掉目录即可卸载
- 改了前端代码后再跑一次即可；只改 Rust 代码时前端构建那步会很快

**产物位置**

```
%LOCALAPPDATA%\Programs\FishTranslateTest\FishTranslateTest.exe
```

---

## build-macos-debug.sh（macOS 测试版）

```
chmod +x debug/build-macos-debug.sh      # 首次需要
./debug/build-macos-debug.sh             # 构建 debug .app
./debug/build-macos-debug.sh --open      # 构建完直接打开
./debug/build-macos-debug.sh --help      # 看帮助
```

**做什么**

1. 校验系统是 macOS、`node` / `cargo` 存在
2. 没有 `node_modules` 时先跑 `npm install`
3. `npm run build` 构建前端
4. `npx tauri build --debug --bundles app` 只打 `.app`（不打 dmg）

**产物位置**

```
src-tauri/target/debug/bundle/macos/Fish翻译.app
```

**注意**

- 只能在 macOS 上跑（脚本会检查 `uname -s`）
- debug 版体积大、启动慢，但能看到控制台日志
- 未签名，本机第一次打开若被 Gatekeeper 拦，右键「打开」即可

---

## 什么时候用这里的脚本

| 场景 | 用哪个 |
|---|---|
| 改了界面/逻辑，想在本机快速看效果 | `build-win-debug.cmd`（Windows） / `build-macos-debug.sh`（macOS） |
| 要看 Rust 侧日志、排查 panic | 同上，debug 版会保留控制台 |
| 要给别人安装包 / 发版 | 根目录的 `build-*.cmd/sh`，产物进 `build/` |

## 编码与换行

- `*.cmd` 用 CRLF，`*.sh` 用 LF（见仓库根目录 `.gitattributes`）
- Windows 脚本内容保持纯 ASCII，避免 `cmd.exe` 按 GBK 解析导致中文路径乱码
