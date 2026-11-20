# 窗口宽度调试角标（size badge）

> 最后更新：2026-11-20
> 相关代码：`src/app.js`（`initSizeBadge` / `renderSizeBadge`）、`src/app.css`（`#size-badge`）、`scripts/build.mjs`

## 用途

在窗口左下角显示当前视口的 **CSS 像素宽 × 高**，用于验证响应式断点（1024 / 768 / 640 / 480）是否落在预期档位。

```
┌──────────────────────────────┐
│                              │
│          界面内容             │
│                              │
│ 680 × 720                    │  ← 左下角角标
└──────────────────────────────┘
```

## 只在 debug 构建里存在

`src/app.js` 里整段逻辑被这个判断包住：

```js
function initSizeBadge() {
  if (__FISH_DEBUG__ !== true) return
  ...
}
```

`__FISH_DEBUG__` 由 `scripts/build.mjs` 在构建时注入：

```js
define: {
  __FISH_DEBUG__: JSON.stringify(process.env.FISH_DEBUG === '1'),
  __APP_VERSION__: JSON.stringify(appVersion),
}
```

- 构建时 **没有** `FISH_DEBUG=1`（也就是 release 包）：`__FISH_DEBUG__` 被替换成 `false`，压缩器会把整个函数体判成死代码剔除，产物里既没有角标样式也没有快捷键监听
- 构建时 **带** `FISH_DEBUG=1`：角标代码被真正打进包里

```bash
# 本地调试构建（带角标）
FISH_DEBUG=1 npm run build && npx tauri build --no-bundle

# release 构建（无角标）
npm run build && npx tauri build
```

## 显隐控制

**debug 构建里默认就显示**，按 `Ctrl + Shift + D` 切换。

```js
const stored = readStore('fish-app.debug-size')
const enabled = stored === null ? true : stored === '1'   // 没有记录时默认开

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey !== true || event.shiftKey !== true) return
  if (String(event.key).toLowerCase() !== 'd') return
  event.preventDefault()
  badge.hidden = !badge.hidden
  writeStore('fish-app.debug-size', badge.hidden ? '0' : '1')
  renderSizeBadge()
})
```

| 项 | 值 |
|---|---|
| 快捷键 | `Ctrl + Shift + D`（**只认 `ctrlKey`，不认 `metaKey`**，macOS 上也是 Ctrl） |
| 记忆键 | `localStorage['fish-app.debug-size']`，`'1'` 显示 / `'0'` 隐藏 |
| 默认 | 没有记录时为显示 |
| 重置 | 清掉 localStorage 该项即可回到默认显示 |

## 显示内容与刷新时机

```js
function renderSizeBadge() {
  const badge = document.getElementById('size-badge')
  if (badge === null) return
  const width = Math.round(window.innerWidth)
  const height = Math.round(window.innerHeight)
  badge.textContent = width + ' × ' + height
}
```

- 取的是 `window.innerWidth / innerHeight`，即 **CSS 像素**，和媒体查询用的数值完全一致
- 刷新时机：创建时一次 + 每次 `window.resize`
- 不显示点宽/缩放比等信息，只显示一个数对

## 样式

```css
#size-badge {
  position: fixed;
  left: 10px;
  bottom: 10px;
  z-index: 3000;          /* 高于弹窗（1000/1100），弹窗开着也能看到 */
  padding: 4px 8px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  pointer-events: none;   /* 不挡点击 */
  opacity: 0.92;
}
```

- 跟随主题取色；像素风主题（`c` / `d`）额外用硬阴影 `3px 3px 0`
- 元素由 JS 动态创建（`document.createElement`）并 append 到 `body`，不是写在 `index.html` 里
- `pointer-events: none` 保证它不拦截鼠标操作

## 常见问题

**1. 为什么角标数字和系统"显示设置"里的缩放对不上？**

角标显示的是 CSS 像素。Windows 150% 缩放下，一个 1800 物理像素宽的窗口里 `innerWidth` 是 1200。

**2. release 包里为什么找不到？**

因为 `FISH_DEBUG` 没设置。这不是 bug，是刻意剔除——正式包不带调试 UI。

**3. 快捷键没反应？**

- 不在 debug 构建里（release 包没有监听）
- 焦点在 `<textarea>` / `<input>` 里时依然有效（监听挂在 `document` 上），但如果某个弹窗内自己 `preventDefault` 了同组合键会抢占
- macOS 上要用 `Ctrl` 而不是 `Cmd`

**4. 弹窗打开时角标被遮住？**

不会。`z-index: 3000` 高于所有弹窗层（`verify-overlay` 1000、移动端抽屉 1090–1200）。

## 改动时的注意事项

1. 角标代码必须保持在 `if (__FISH_DEBUG__ !== true) return` 之后，否则会进 release 包
2. `#size-badge` 的样式写在 `app.css` 里是**无条件编译**进去的（几十字节的 CSS），如果介意可以从 CSS 中删掉，由 JS 内联样式替代
3. 快捷键组合与「粘贴为纯文本」的 `Ctrl+Shift+V` 不冲突，但新增快捷键时注意别和它重叠
