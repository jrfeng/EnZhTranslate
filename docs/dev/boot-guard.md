# 启动白屏处理（窗口底色 + 启动遮罩）

> 最后更新：2026-11-20
> 相关代码：`src-tauri/src/lib.rs`、`src/index.html`、`src/app.css`、`src/main.js`、`src/boot-head.js`、`src/boot-body.js`

## 目标

从进程启动到界面可用的这几百毫秒里，用户不应该看到：

- 一块白色窗口（WebView2 还没画出内容）
- 深色模式下闪一下浅色
- 浅色模式下闪一下深色
- 组件升级到一半的错乱排版

## 现在的做法：一层底色 + 一层遮罩

```
┌────────────────────────────────────────────┐
│ Rust：按上次主题设置窗口背景色（WebView 绘制前就生效）│  ← 底色
│ ┌────────────────────────────────────────┐ │
│ │ HTML：全屏 .boot-cover（颜色 = --app-bg） │ │  ← 遮罩
│ │   app.js 渲染完成后淡出并移除             │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

### ① 窗口底色（Rust）

```rust
// lib.rs · setup
let theme_id = startup_theme_id(&window);     // 上次保存的主题，没有就跟随系统
apply_window_theme_color(&window, &theme_id); // set_background_color(...)
let _ = window.show();                        // 立刻显示，不等前端
```

- 主题 id → RGB 的映射与 `app.css` 的 `--app-bg` 一一对应（`theme_background`）
- 用 Tauri 的 `window.set_background_color()`（底层是 WebView2 的 `DefaultBackgroundColor`），在 WebView 画出第一帧之前就决定底色
- 窗口**不再等 `app_ready`**，创建完直接显示——因为底色已经是对的，不会白

### ② 主题持久化（左右两端共享）

窗口底色必须在窗口创建时就能确定，而主题存在 localStorage 里（Rust 读不到），所以另存一份：

```
%APPDATA%\com.local.fish.translate\theme.json     ← 内容就是 a / b / c / d
```

| 时机 | 行为 |
|---|---|
| 启动 | Rust 读 `theme.json`；文件不存在则用系统深浅色（`window.theme()`） |
| 前端应用主题 | `applyTheme()` 里调用 `save_theme` 命令，写入解析后的 id，并更新窗口底色 |

前端传的是**解析后**的值（`auto` → `a`/`b`），所以系统切深色时文件也会同步。

### ③ 启动遮罩（前端）

```html
<!-- index.html，紧跟 <body> -->
<div class="boot-cover" id="boot-cover" aria-hidden="true"></div>
```

```css
.boot-cover {
  position: fixed;
  inset: 0;
  z-index: 2500;                 /* 高于所有弹窗，低于 fatal-error 条 */
  background: var(--app-bg, #0d0d10);
  pointer-events: none;
  transition: opacity 0.18s ease;
}
.boot-cover.is-hidden { opacity: 0; }
```

- 颜色来自 `--app-bg`，而 `data-theme` 由 `boot-head.js` 在 `<head>` 里同步写入，所以**遮罩的第一帧就是正确颜色**
- 移除时机：`main.js` 里 `app.js` 渲染完成之后，**双 `requestAnimationFrame`** 再淡出（保证这一帧已经进了合成层）
- `app.js` 抛错也要撤：`try/finally` 包住 `import`

### ④ 兜底

| 场景 | 兜底 |
|---|---|
| `app.js` 抛错 | `main.js` 的 `finally` 撤掉遮罩 |
| `app.js` 卡住（组件升级死锁） | `boot-body.js` 里 4 秒后强制移除遮罩并放行界面 |
| 主题文件损坏 / 不存在 | 跟随系统深浅色 |

## 为什么删掉了旧的 `FISH_BOOT_GUARD`

旧方案是「窗口隐藏 + 等 `app_ready` + 内容隐藏 + 1.5s/2s 兜底延时」四件套，用一个构建开关整体开关。问题是：

- 它把「窗口等待」和「主题兜底」捆在一起，关掉开关会连主题一起丢，直接白屏
- 窗口要等前端就绪才显示，启动感知上慢 100–160ms

新方案把两件事拆开了：

- **底色**由 Rust 在窗口创建时决定 → 窗口可以立刻显示
- **内容**由遮罩负责 → 组件没升级完也不会露出来

所以不再需要那个开关，`FISH_BOOT_GUARD`、`data-boot-guard`、1.5s/2s 定时器全部移除。

## 实测（本机，Windows 150% 缩放）

启动时序：

| 时刻 | 事件 |
|---|---|
| ~90 ms | `boot-head.js` 写入 `data-theme` |
| ~250 ms | Rust 设好底色并 `window.show()`，遮罩已经盖住整窗 |
| ~350 ms | 组件升级完成，`app.js` 开始渲染 |
| ~450 ms | 遮罩淡出，界面可用 |

不同主题下窗口中部像素采样（可见后 120ms）：

| theme.json | 采样颜色 | 对应 |
|---|---|---|
| `b` 浅色 | rgb(223,235,251) | 浅色底 |
| `a` 深色 | rgb(13,13,16) | `#0d0d10` |
| `d` 蓝鱼 | rgb(221,234,251) | `#dce9fb` |

浅色主题不再出现深色底板，深色主题也不会闪白。

## 已知局限

1. **窗口出现后的第一帧（约 10ms）** 可能还是"未合成"状态，截图会捕到桌面内容。这是 DWM 的合成时机，应用层无法控制
2. **主题切换瞬间**：`save_theme` 会立刻更新窗口底色，页面内已无遮罩，极端情况下可能看到一帧色差（正常主题切换时被 `.boot-cover` 之外的重绘掩盖）
3. 遮罩本身也是 WebView 画的：如果渲染进程崩溃，遮罩和界面会一起消失

## 改动时的注意事项

1. `theme_background()` 里的颜色必须与 `app.css` 中对应主题的 `--app-bg` 保持一致，改主题色时两边都要改
2. `.boot-cover` 的 `z-index` 要高于所有弹窗层级（当前弹窗最高 1200），低于 `fatal-error`（9999）
3. 遮罩的移除只能在 `app.js` 渲染之后，提前移除会露出未升级组件的排版
4. 如果将来新增主题，`save_theme` 的白名单、`theme_background()`、`boot-head.js` 的主题校验三处都要加
