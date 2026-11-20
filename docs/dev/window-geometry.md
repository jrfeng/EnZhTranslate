# 窗口尺寸与位置记忆

> 最后更新：2026-11-20
> 相关代码：`src-tauri/src/lib.rs`（`窗口几何记忆` 一节）
> 配置文件：`%APPDATA%\com.local.fish.translate\window-size.json`

## 行为

| 场景 | 结果 |
|---|---|
| 调整尺寸 / 移动窗口后关闭 | 下次启动恢复到关闭前的尺寸和位置 |
| 最大化状态下关闭 | 下次启动**直接最大化**；内部仍记着最大化前的尺寸，取消最大化后回到该尺寸 |
| 进程被强杀 | 恢复到强杀前的几何（拖动/缩放时每 700ms 落盘一次） |
| 首次启动（无记录） | 使用 `tauri.conf.json` 的默认值：1180×780，居中 |
| 配置损坏 / 数值越界 | 忽略，回落默认值 |
| 保存的位置落在屏幕外（拔了副屏等） | **只恢复尺寸**，位置回落到系统默认居中 |
| 全屏状态关闭 | 跳过保存（保留上一次的值） |

## 启动时序

几何恢复必须发生在窗口显示之前，否则用户会看到「默认尺寸 → 跳到记忆尺寸」。

```rust
// lib.rs · setup
if let Some(window) = app.get_webview_window("main") {
    restore_window_size(&window);                          // ① 几何
    let theme_id = startup_theme_id(&window);
    apply_window_theme_color(&window, &theme_id);          // ② 主题底色
    if startup_maximized() { let _ = window.maximize(); }   // ③ 最大化
    let _ = window.show();                                 // ④ 显示
}
```

另外 `app_ready` 命令里还会**再恢复一次**：

```rust
restore_window_size(&window);   // show 前
let _ = window.show();
restore_window_size(&window);   // show 后：压掉 WebView2 首帧的重算
```

这是历史经验——只在 setup 里设一次，WebView2 首帧会把尺寸改回配置默认值。

## 保存时机

| 事件 | 说明 |
|---|---|
| `CloseRequested` | 正常关闭，最准 |
| `Resized` / `Moved` | 节流 700ms，防止强杀丢失 |
| `RunEvent::Exit` | 有些关闭路径不触发窗口事件，退出前补一次 |

## 配置文件格式

```json
{ "version": 1, "x": 260, "y": 180, "width": 825, "height": 631, "maximized": false }
```

- 全部是**逻辑像素**（CSS px），跨 DPI 缩放保持一致
- `version` 预留，未知字段忽略
- 校验规则：宽 360–7680、高 480–4320、坐标 ±32768，且必须与某块显示器相交 ≥120×80 才应用位置

## 最大化是怎么处理的

关键点：**不要把屏幕尺寸当成用户想要的尺寸存进去**。

```rust
// 每次非最大化状态下的移动/缩放，都更新内存里的 LAST_NORMAL
if !maximized { update_last_normal(window); }

// 写盘时：
// - 普通状态 → 当前几何
// - 最大化   → LAST_NORMAL（不存在则读旧文件里的几何）
let geometry = if maximized { last_normal().or(saved) } else { current() };
```

所以「最大化 → 关闭 → 重开」的结果是：

1. 启动时按 `maximized: true` 直接最大化
2. 用户点还原，回到最大化之前的 820×600，而不是满屏尺寸

## 诊断日志

**只在 `FISH_DEBUG=1` 的构建里编译**（release 包整段剔除）：

```
控制台：[window] restore 825x631 @ 260,180 maximized=false
文件：  %TEMP%\fish-window.log
```

记录内容：

| 事件 | 示例 |
|---|---|
| 启动恢复 | `restore 825x631 @ 260,180 maximized=false` |
| 无有效记录 | `restore: no valid saved state` |
| 位置越界 | `restore: position 7500,6000 off-screen, keep default` |
| 保存 | `save 825x631 @ 260,180 maximized=false` |
| 跳过保存 | `skip save (close): fullscreen` |

排查「不生效」时先看这个文件：能区分是**没存**、**存了但校验没过**、还是**恢复被覆盖**。

## 常见问题

**Q：恢复后尺寸差了几个像素？**
存的是 `inner_size`（客户区），恢复用 `set_size`；`decorations: false` 的窗口外框会带来约 15px 差，属正常。

**Q：换了缩放比（150% → 100%）会怎样？**
尺寸按逻辑像素恢复，视觉大小一致；位置若落到屏幕外会被忽略并居中。

**Q：多显示器能记住「在哪块屏」吗？**
不能，只记绝对坐标。副屏拔掉后靠可见性校验兜底，回落到主屏居中。

**Q：如何重置窗口位置？**
删掉 `%APPDATA%\com.local.fish.translate\window-size.json` 后重启即可。

## 改动时的注意事项

1. `restore_window_size` 必须在 `window.show()` 之前调用（`setup` 与 `app_ready` 两处都是）
2. 保存逻辑里的「最大化用 LAST_NORMAL」不要退化回「最大化直接跳过」——否则最大化关闭会丢失尺寸
3. 新增字段时保留 `version`，旧文件缺少字段要有默认值
4. `WINDOW_DEBUG` 依赖构建时的 `FISH_DEBUG=1`，release 构建里不会写日志
