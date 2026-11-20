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

  /* 首屏兜底延时：组件升级卡住时提前放出界面，避免一直黑屏/白屏。
     默认关闭（会让人感觉启动慢 1.5~2 秒），需要时用下面任一开关打开：
       1) 构建时：FISH_BOOT_GUARD=1 npm run build
       2) 运行时：localStorage.setItem('fish-app.boot-guard', '1')（设 '0' 可强制关闭） */
  var BOOT_GUARD_DEFAULT = false
  var bootGuard = BOOT_GUARD_DEFAULT
  try {
    var savedGuard = localStorage.getItem('fish-app.boot-guard')
    if (savedGuard === '1') bootGuard = true
    else if (savedGuard === '0') bootGuard = false
  } catch (error) {
    /* 读不到就用默认值 */
  }

  if (bootGuard) {
    setTimeout(function () {
      document.documentElement.classList.add('app-ready')
    }, 1500)

    /* 兜底：万一 app.js 没跑起来，窗口默认是隐藏的（防白闪），这里强制放出来，
       否则用户会看到一个「什么都不发生」的进程 */
    setTimeout(function () {
      try {
        window.__TAURI__.core.invoke('app_ready')
      } catch (error) {
        /* 不是 Tauri 环境（浏览器里调试）就算了 */
      }
    }, 2000)
  }
})()
