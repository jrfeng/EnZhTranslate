# 防白屏机制（boot guard）

> 最后更新：2026-11-20
> 相关代码：`src/boot-head.js`、`src/boot-body.js`、`src/main.js`、`src/app.css`、`src-tauri/src/lib.rs`、`scripts/build.mjs`

## 一套机制，四道保险

窗口在 `tauri.conf.json` 里是 `visible: false`。从进程启动到界面可用这几百毫秒里，如果不做处理，用户可能看到：

- 一块白底窗口（WebView2 还没画出内容）
- 未应用主题的界面（浅色闪一下再变深色）
- Web Awesome 组件升级到一半的错乱排版

所以整套「防白屏」由四个动作组成，它们**必须一起开、一起关**：

| # | 机制 | 实现位置 | 作用 |
|---|---|---|---|
| ① | **窗口不可见** | `tauri.conf.json` `"visible": false` + `lib.rs` 的 `setup`/`app_ready` | 界面没准备好之前，窗口根本不出现 |
| ② | **主题先行** | `boot-head.js`（`<head>` 里同步执行） | 首帧之前把 `data-theme` 写到 `<html>`，深色模式下不会闪白 |
| ③ | **内容隐藏** | `app.css` 的 `html[data-boot-guard='1']:not(.app-ready) .app` | 组件升级完成前不显示内容，避免错乱排版 |
| ④ | **首屏兜底延时** | `boot-body.js` 的 1.5s / 2s 定时器 | 组件升级卡死时强行放出界面和窗口 |

## 总开关

**构建期**，由 `FISH_BOOT_GUARD` 环境变量控制，默认关闭：

```bash
# 打开全部四道保险
FISH_BOOT_GUARD=1 npm run build
npx tauri build --no-bundle        # 同一个环境变量会传给 cargo

# 默认：全部关闭（启动最快，但可能看到白闪/排版跳一下）
npm run build && npx tauri build --no-bundle
```

注入链路（一个变量，两处注入）：

```
FISH_BOOT_GUARD=1
   ├── scripts/build.mjs → dist/boot-head.js 里 BOOT_GUARD_DEFAULT = true
   │     → boot-head 写 document.documentElement.dataset.bootGuard = '1'
   │       → ② 主题先行生效
   │       → ③ CSS 选择器命中，内容隐藏
   │       → boot-body 读到 dataset，④ 定时器生效
   └── cargo 编译期 option_env!("FISH_BOOT_GUARD") → lib.rs 的 BOOT_GUARD_ENABLED
         → ① 窗口保持隐藏，等 app_ready
```

> 早期版本还有一个运行时开关 `localStorage['fish-app.boot-guard']`，它只能影响前端，Rust 侧读不到，会造成「四道保险状态不一致」。现已移除，只保留构建期开关。

## 开关状态下的行为对比

### 打开（`FISH_BOOT_GUARD=1`）

| 时刻 | 发生什么 |
|---|---|
| 启动 | 窗口隐藏（①） |
| `<head>` 执行 | 立即写入 `data-theme`（②），深色模式首帧就是深色 |
| 组件升级前 | `.app` 不可见（③），用户看不到错乱排版 |
| 组件升级完成 + 一帧 | `main.js` 加 `app-ready`，内容显示 |
| `app.js` 执行完 | `main.js` 调 `app_ready` → 窗口显示 |
| 组件卡死 | 1.5s 强制加 `app-ready`，2s 强制显示窗口（④） |

实测主窗口可见耗时：**约 330–500 ms**

### 关闭（默认）

| 时刻 | 发生什么 |
|---|---|
| 窗口创建后 | `lib.rs` 的 `setup` 立刻 `window.show()`（① 关闭） |
| `<head>` | 不写 `data-theme`（② 关闭），主题等 `app.js` 启动后再设 |
| 全程 | `.app` 一直可见（③ 关闭），组件升级过程可能看到排版跳动 |
| 不存在定时器 | ④ 关闭 |

实测主窗口可见耗时：**约 225–405 ms**（比开启态快 100 ms 左右）

### 关闭后的代价

- 深色模式下可能出现**一次白闪**（窗口先出现，主题还没设）
- 组件升级过程中可能看到工具栏**排版的瞬间跳动**

这两点就是关闭四道保险换来的启动速度，属于预期行为。

## 各层为什么"必须一起"

| 只关一部分会怎样 | 结果 |
|---|---|
| ① 开、② 关 | 窗口隐藏到就绪，但内容里是浅色 → 显示瞬间闪白 |
| ① 关、② 开 | 窗口立刻出现，但 `.app` 隐藏 → 用户看到一块空的主题色窗口 |
| ①③ 开、② 关 | 就绪后窗口出现，但主题是事后补的 → 可能闪一下 |
| ③ 关、① 开 | 窗口虽隐藏，但组件升级的半成品已经在渲染，就绪后内容会跳 |

所以四者是一个原子组合，代码上也用同一个 `data-boot-guard` 标记驱动。

## 排查白屏时怎么用

1. 先确认构建时是否带了 `FISH_BOOT_GUARD=1`：

   ```bash
   Select-String -Path dist/boot-head.js -Pattern 'BOOT_GUARD_DEFAULT'
   ```

2. 运行时检查（DevTools 控制台）：

   ```js
   document.documentElement.dataset.bootGuard   // '1' 开 / '0' 关
   document.documentElement.dataset.theme        // 'a' / 'b' / 'c' / 'd'（关闭状态下可能为空）
   document.documentElement.classList.contains('app-ready')
   ```

3. 如果打开四道保险后仍然白屏，说明问题不在启动时序，而在更底层：
   - `boot-head.js` 没被加载（检查 `dist/` 里是否缺文件、CSP 是否拦截）
   - 主题 CSS 没加载（`--app-bg` 缺省时 `body` 背景透明，画布会回退白色）
   - 详见 `docs/dev/` 下关于主题兜底的说明

## 改动时的注意事项

1. `var BOOT_GUARD_DEFAULT = false` 这一行是**构建脚本做文本替换的锚点**，改名要同步改 `scripts/build.mjs`
2. Rust 侧的 `BOOT_GUARD_ENABLED` 用 `option_env!` 读取，cargo 会因环境变量变化自动重编译；如果发现没生效，先 `cargo clean -p fish-translate` 再构建
3. 不要单独关闭其中一层——要么四层全开，要么全关
4. 如果将来把窗口改成默认可见（`visible: true`），① 就失去意义，需要重新设计这套时序
