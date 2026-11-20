/**
 * 首屏脚本：在 CSS 和 app.js 之前执行，负责
 * 1. 尽早挂上主题，避免深色主题下闪白
 * 2. 标记平台，供标题栏布局使用
 *
 * 单独成文件（而不是内联）是为了能开严格的 CSP：script-src 'self'。
 */
;(function () {
  // 主题在首帧之前设好：窗口底色与启动遮罩都依赖它，不能等 app.js
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
