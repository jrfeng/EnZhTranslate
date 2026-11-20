# 启动兜底延时（boot guard）

> 最后更新：2026-11-20
> 相关代码：`src/boot-body.js`、`scripts/build.mjs`、`src/main.js`、`src-tauri/src/lib.rs`

## 这个延时是干什么的

窗口在 `tauri.conf.json` 里是 `visible: false`，等前端把首屏渲染好之后再调用 `app_ready` 命令显示，避免用户先看到一个白屏窗口再「闪」一下变成界面。

但 Web Awesome 的自定义元素（`wa-button` / `wa-select` 等）需要先升级完成才能正确排版。如果升级过程卡住，`main.js` 就不会走到「显示窗口」那一步，用户会看到一个后台进程但没有任何窗口。

于是 `src/boot-body.js` 里加了一段**兜底延时**：

```js
setTimeout(() => document.documentElement.classList.add('app-ready'), 1500)
setTimeout(() => window.__TAURI__.core.invoke('app_ready'), 2000)
```

- 1.5 秒：强制给 `<html>` 加 `app-ready` 类（`.app` 在拿到这个类之前是 `visibility: hidden`）
- 2 秒：直接调用 `app_ready` 把窗口显示出来

代价是：一旦真的等到这两个定时器，界面出现的时间就被人为推迟到 1.5–2 秒，看起来「启动很慢」。

## 开关

**默认关闭**（追求启动速度），需要排查白屏问题时再打开。

### 构建时

```bash
# 打开兜底
FISH_BOOT_GUARD=1 npm run build

# 默认（关闭）
npm run build
```

`scripts/build.mjs` 复制 `boot-body.js` 到 `dist/` 时会做一次文本替换：

```js
bootBody.replace(
  'var BOOT_GUARD_DEFAULT = false',
  `var BOOT_GUARD_DEFAULT = ${process.env.FISH_BOOT_GUARD === '1'}`,
)
```

### 运行时（无需重新构建）

在 DevTools 控制台里执行：

```js
localStorage.setItem('fish-app.boot-guard', '1')   // 打开
localStorage.setItem('fish-app.boot-guard', '0')   // 强制关闭（优先级高于构建默认值）
```

读取逻辑在 `boot-body.js`：先取构建默认值，再被 localStorage 覆盖。

## 关闭后由谁负责显示窗口

关掉兜底并不意味着窗口永远不显示，正常路径依然完整：

| 环节 | 触发者 |
|---|---|
| 给 `<html>` 加 `app-ready` | `src/main.js`（组件升级完成 + 一帧 rAF 之后） |
| 显示窗口 | `src/main.js` 末尾 `invoke('app_ready')` |
| 最后兜底（4 秒） | `src-tauri/src/lib.rs` 的 `setup` 线程：无论如何 4 秒后 `window.show()` |

所以真正会「什么都不显示」的情况，需要同时满足：前端脚本没执行 + Rust 兜底线程也没跑到。

## 实测数据（本机，Windows 150% 缩放）

| 指标 | 耗时 |
|---|---|
| 进程启动 → 主窗口可见 | 约 385 ms |
| 主窗口可见 → 界面渲染完成 | < 520 ms |

可见在正常路径下，兜底定时器根本不会触发；关闭它不会影响任何功能，只是把「故障时慢」变成「故障时不显示（由 Rust 4 秒兜底接手）」。

## 一个容易忽略的细节

`boot-body.js` 开头有提前返回：

```js
if (!settings.apiKey || !isDeepSeek) return
```

这段脚本的本职工作是「在首帧之前把余额占位摆好」，只有配置了 DeepSeek 官方接口的用户才会走完整逻辑。因此：

- **没配 API Key 的用户，本来就不会经历这 1.5 秒延时**
- 只有配置过且被兜底命中的用户才会感觉到「启动慢」

## 改动这段代码时的注意事项

1. `BOOT_GUARD_DEFAULT` 这一行是**构建脚本做文本替换**的锚点，改名字要同步改 `scripts/build.mjs`
2. 不要删掉兜底逻辑本身——排查白屏问题时它是唯一能在前端卡死时救场的机制
3. `app-ready` 类只控制 `.app` 的 `visibility`，提前加不会造成闪烁（内容此时若未渲染就是空的），但会让人看到未排版界面
4. 如果将来把窗口改成默认可见（`visible: true`），这套兜底和 `app_ready` 调用都要重新评估
