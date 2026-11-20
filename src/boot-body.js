/**
 * 首帧脚本（放在 <body> 里、工具栏之后执行）：
 * 1. 余额是异步读回来的，占位必须在首帧之前就位，否则工具栏会跳一下
 * 2. 组件升级卡住时的兜底：1.5 秒后把界面放出来
 *
 * 单独成文件（而不是内联）是为了能开严格的 CSP：script-src 'self'。
 */
;(function () {
  try {
    var raw = localStorage.getItem('fish-app.settings')
    var settings = raw ? JSON.parse(raw) : {}
    var base = String(settings.baseURL || 'https://api.deepseek.com')
    var isDeepSeek = base.indexOf('deepseek.com') !== -1
    if (!settings.apiKey || !isDeepSeek) return

    var wrap = document.getElementById('balance-wrap')
    var tag = document.getElementById('balance')
    var divider = document.getElementById('balance-divider')
    if (!wrap || !tag || !divider) return

    var cached = null
    try {
      cached = JSON.parse(localStorage.getItem('fish-app.balance') || 'null')
    } catch (error) {
      cached = null
    }

    if (cached && typeof cached.text === 'string' && cached.text.length > 0) {
      tag.textContent = cached.text
      tag.title = cached.title || '（点击刷新）'
      if (cached.variant) tag.variant = cached.variant
      tag.classList.remove('is-placeholder')
    } else {
      tag.textContent = '余额 --'
      tag.classList.add('is-placeholder')
      tag.title = '正在读取余额…'
    }

    wrap.hidden = false
    divider.hidden = false
  } catch (error) {
    /* 配置读不出来就当作没有余额 */
  }

  /* 兜底：万一 app.js 卡住没跑起来，遮罩不会自己消失。
     4 秒后强制撤掉遮罩并放行界面，避免用户一直盯着一块纯色窗口。 */
  setTimeout(function () {
    var cover = document.getElementById('boot-cover')
    if (cover) cover.remove()
    document.documentElement.classList.add('app-ready')
  }, 4000)
})()
