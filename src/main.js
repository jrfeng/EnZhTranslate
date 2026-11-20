/**
 * 前端入口：注册 Web Awesome 组件，等组件升级完成后再交给 app.js。
 * 这些 import 由 esbuild 打包成 dist/app.js。
 *
 * 为什么要等：自定义元素在脚本执行前是「未升级」状态，
 * <wa-select> / <wa-button> 会按内联元素排版，尺寸和升级后差不少，
 * 直接渲染会让工具栏先按错误宽度排一次、再跳一下。
 */

import '@awesome.me/webawesome/dist/components/button/button.js'
import '@awesome.me/webawesome/dist/components/dialog/dialog.js'
import '@awesome.me/webawesome/dist/components/input/input.js'
import '@awesome.me/webawesome/dist/components/option/option.js'
import '@awesome.me/webawesome/dist/components/select/select.js'
import '@awesome.me/webawesome/dist/components/tag/tag.js'

const TAGS = ['wa-button', 'wa-dialog', 'wa-input', 'wa-option', 'wa-select', 'wa-tag']

await Promise.all(TAGS.map((tag) => customElements.whenDefined(tag)))
// 等一帧，确保升级后的样式已经算进布局，再显示界面
await new Promise((resolve) => requestAnimationFrame(() => resolve()))
document.documentElement.classList.add('app-ready')

// 实验：启动遮罩在 app.js 首屏渲染完成后再淡出（双 rAF 保证这一帧已进合成层）
function dropBootCover() {
  const cover = document.getElementById('boot-cover')
  if (cover === null) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cover.classList.add('is-hidden')
      window.setTimeout(() => cover.remove(), 220)
    })
  })
}

try {
  await import('./app.js')
} finally {
  // app.js 抛错也要撤掉遮罩，否则用户永远看不到界面
  dropBootCover()
}

// 首屏渲染完成后再让 Rust 把窗口显示出来：窗口一直不可见，就不会先闪一下白底
try {
  await window.__TAURI__?.core?.invoke?.('app_ready')
} catch (error) {
  /* 显示失败就交给 Rust 侧那条 4 秒兜底 */
}
