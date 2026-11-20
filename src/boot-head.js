/**
 * 首屏脚本：在 CSS 和 app.js 之前执行，负责
 * 1. 尽早挂上主题，避免深色主题下闪白
 * 2. 标记平台，供标题栏布局使用
 *
 * 单独成文件（而不是内联）是为了能开严格的 CSP：script-src 'self'。
 */
;(function () {
  /* 防白屏机制总开关（构建时由 scripts/build.mjs 替换）：打开后才有
     「主题先行 + 内容隐藏 + 首屏兜底延时」，Rust 侧窗口也保持隐藏到 app_ready。
     默认关闭，FISH_BOOT_GUARD=1 构建打开。 */
  var BOOT_GUARD_DEFAULT = false
  var bootGuard = BOOT_GUARD_DEFAULT
  document.documentElement.dataset.bootGuard = bootGuard ? '1' : '0'

  // 实验：主题永远在首帧之前设好（遮罩颜色依赖 --app-bg）
  try {
    var saved = localStorage.getItem('fish-app.theme')
    var id = saved === 'a' || saved === 'b' || saved === 'c' || saved === 'd' ? saved : null
    if (!id) id = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'a' : 'b'
    document.documentElement.dataset.theme = id
    if (id === 'a') document.documentElement.classList.add('wa-dark')
  } catch (error) {}

  // 标记平台：macOS 用系统红绿灯，Windows 用自绘按钮
  try {
    var ua = navigator.userAgent || ''
    var platform = /Macintosh|Mac OS X/i.test(ua) ? 'mac' : /Linux/i.test(ua) ? 'linux' : 'win'
    document.documentElement.dataset.platform = platform
  } catch (error) {}
})()
