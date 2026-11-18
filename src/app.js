/**
 * 多语言翻译 · 独立版前端
 *
 * 纯原生 JS，没有构建步骤。负责：Markdown 输入高亮、Markdown 预览/源码切换、
 * 术语表、模型选择、自动复制、进度动画，以及把请求发给本机服务。
 */

/* ------------------------------------------------------------ 常量与状态 */

/** 把致命错误直接显示在页面上，避免出现「一片白」却无从排查 */
function showFatalError(message) {
  try {
    let bar = document.getElementById('fatal-error')
    if (bar === null) {
      bar = document.createElement('pre')
      bar.id = 'fatal-error'
      bar.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:9999;max-height:45%;overflow:auto;' +
        'margin:0;padding:12px 16px;background:#b3261e;color:#fff;' +
        'font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap'
      document.body.appendChild(bar)
    }
    bar.textContent += '启动出错：' + message + '\n'
  } catch (error) {
    // 连错误条都画不出来就算了
  }
}

window.addEventListener('error', (event) => {
  showFatalError(event.message || String(event.error || '未知错误'))
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  showFatalError(reason && reason.message ? String(reason.message) : String(reason))
})

const MAX_TERMS = 50
const COPIED_MS = 1600

/** 余额提醒阈值：低于该数值时变色（橙色 < 3，红色 < 2） */
const BALANCE_WARN = 3
const BALANCE_DANGER = 2
/** 余额手动刷新的进度条最短显示时长 */
const BALANCE_MIN_PROGRESS_MS = 1000

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'

const TASK_STRUCTURE = [
  '【本次任务（优先于其他格式要求）】',
  '先把原文整理成 Markdown，再翻译：',
  '- 并列、分步、逐条的内容用有序或无序列表；',
  '- 有明显分节的内容用标题；',
  '- 代码、命令、文件路径、接口路径、变量名用行内代码（反引号）包裹；',
  '- 纯叙述性段落保持为普通段落。',
  '只做结构整理，不许增删或改写任何信息。',
]

/** 按目标语言生成用户消息里的任务说明 */
function taskBrief(target) {
  return [
    ...TASK_STRUCTURE,
    '',
    `然后把整理出的 Markdown 翻译成${target}：Markdown 标记和代码原样保留，代码块里的代码不翻译。`,
    `只输出${target}译文本身，不要输出原文，不要任何解释或前言。`,
  ].join('\n')
}

const KEYS = {
  settings: 'fish-app.settings',
  terms: 'fish-app.terms',
  autoCopy: 'fish-app.auto-copy',
  immediate: 'fish-app.immediate',
  termsOpen: 'fish-app.terms-open',
  view: 'fish-app.view',
  theme: 'fish-app.theme',
  sourceLang: 'fish-app.source-lang',
  targetLang: 'fish-app.target-lang',
  models: 'fish-app.models',
  balance: 'fish-app.balance',
}

/** 可选的源/目标语言：只收 DeepSeek 表现稳定的语种，中英排最前 */
const LANGS = [
  '简体中文',
  '英语',
  '日语',
  '韩语',
  '法语',
  '德语',
  '西班牙语',
  '俄语',
  '葡萄牙语',
  '意大利语',
  '阿拉伯语',
  '越南语',
  '泰国语',
  '印尼语',
]

const DEFAULT_SOURCE_LANG = '英语'
const DEFAULT_TARGET_LANG = '简体中文'

/** 内置主题：auto 跟随系统 / b 浅色 / a 深色 / c 风格化 */
const THEMES = [
  { id: 'auto', name: '跟随系统' },
  { id: 'b', name: '浅色' },
  { id: 'a', name: '深色' },
  { id: 'c', name: '风格化' },
  { id: 'd', name: '蓝色大肥鱼' },
]

const config = { apiKey: '', baseURL: DEFAULT_BASE_URL, model: DEFAULT_MODEL }

/** 调用 Rust 侧命令；不在 Tauri 窗口里打开时返回一个可读的错误。 */
function invokeTauri(command, request) {
  const core = window.__TAURI__ !== undefined ? window.__TAURI__.core : undefined
  if (core === undefined || core === null || typeof core.invoke !== 'function') {
    return Promise.resolve({
      ok: false,
      error: { code: 'NO_BRIDGE', message: '请通过打包后的桌面程序打开本页面。' },
    })
  }
  return core.invoke(command, { request })
}

const state = {
  input: '',
  output: '',
  phase: 'idle',
  message: '',
  view: 'preview',
  autoCopy: false,
  immediate: false,
  terms: [],
  termSource: '',
  termTarget: '',
  termsOpen: true,
  sourceLang: DEFAULT_SOURCE_LANG,
  targetLang: DEFAULT_TARGET_LANG,
  translatedText: '',
  translatedTerms: '',
  translatedModel: '',
  translatedSource: '',
  translatedTarget: '',
  copyState: 'idle',
  selectedModel: DEFAULT_MODEL,
  models: [],
  settingsOpen: false,
  /** 当前主题 id：auto / a / b / c */
  theme: 'auto',
  /** 图片识别状态 */
  ocrBusy: false,
  /** 用户点击余额手动刷新时显示进度条 */
  balanceBusy: false,
  ocrMessage: '',
  ocrError: false,
  /** 这张图是否已经跑过一次 OCR（跑过才显示「刷新」按钮） */
  ocrDone: false,
  /** 当前预览的图片：{ url, name, width, height } */
  image: null,
  /** 是否正在显示「清空术语」确认框。 */
  confirmClear: false,
  /** 每发起一次翻译自增，用于丢弃过期响应。 */
  runId: 0,
  copyTimer: 0,
  outputKey: '',
  /** 最近一次翻译的 token 用量明细 */
  usage: null,
  /** 本次运行累计的 token 与次数 */
  usageTotal: 0,
  usageCount: 0,
}

const el = {}
for (const id of [
  'settings-toggle',
  'settings-dot',
  'close-settings',
  'settings',
  'balance',
  'balance-wrap',
  'balance-progress',
  'balance-divider',
  'theme-select',
  'source-lang',
  'target-lang',
  'pick-image',
  'image-input',
  'ocr-status',
  'ocr-progress',
  'image-preview',
  'image-thumb',
  'image-name',
  'image-size',
  'image-zoom',
  'image-refresh',
  'toast-stack',
  'verify-overlay',
  'verify-image',
  'verify-stage',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'zoom-value',
  'verify-editor',
  'verify-confirm',
  'verify-save',
  'verify-close',
  'verify-view',
  'verify-preview',
  'confirm-keep',
  'confirm-discard',
  'win-min',
  'win-max',
  'win-close',
  'api-key',
  'base-url',
  'save-settings',
  'settings-hint',
  'model-select',
  'char-count',
  'clear',
  'translate',
  'hl',
  'source',
  'term-count',
  'term-clear',
  'confirm-modal',
  'confirm-cancel',
  'confirm-ok',
  'terms-toggle',
  'terms-body',
  'term-source',
  'term-target',
  'term-add',
  'terms-list',
  'auto-copy',
  'immediate',
  'stale',
  'view-toggle',
  'copy',
  'progress',
  'output',
  'usage-foot',
  'usage-chip',
  'usage-chip-text',
  'usage-pop',
  'usage-pop-total',
  'usage-rows',
  'usage-pop-foot',
]) {
  el[id] = document.getElementById(id)
}

/* ------------------------------------------------------------------ 转义 */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    return '&#39;'
  })
}

function safeHref(value) {
  const url = String(value).trim()
  return /^(https?:|mailto:)/i.test(url) ? url : null
}

/* -------------------------------------------------------- Markdown 解析 */

const MD_FENCE = /^\s*(```|~~~)\s*([^`~]*)$/
const MD_HEADING = /^(#{1,6})\s+(.*)$/
const MD_HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const MD_QUOTE = /^\s*>\s?(.*)$/
const MD_BULLET = /^\s*[-*+]\s+(.*)$/
const MD_ORDERED = /^\s*\d+[.)]\s+(.*)$/

function startsBlock(line) {
  return (
    MD_FENCE.test(line) ||
    MD_HEADING.test(line) ||
    MD_HR.test(line) ||
    MD_QUOTE.test(line) ||
    MD_BULLET.test(line) ||
    MD_ORDERED.test(line)
  )
}

function splitTableRow(line) {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map((cell) => cell.trim())
}

function parseMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim().length === 0) {
      index += 1
      continue
    }

    const fence = MD_FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1].slice(0, 3)
      const lang = fence[2].trim()
      const body = []
      const closing = new RegExp('^\\s*' + marker + '\\s*$')
      index += 1
      while (index < lines.length && !closing.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    const heading = MD_HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }

    if (MD_HR.test(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (MD_QUOTE.test(line)) {
      const body = []
      while (index < lines.length && MD_QUOTE.test(lines[index])) {
        body.push(MD_QUOTE.exec(lines[index])[1])
        index += 1
      }
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }

    if (MD_BULLET.test(line)) {
      const items = []
      while (index < lines.length && MD_BULLET.test(lines[index])) {
        items.push(MD_BULLET.exec(lines[index])[1])
        index += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (MD_ORDERED.test(line)) {
      const items = []
      while (index < lines.length && MD_ORDERED.test(lines[index])) {
        items.push(MD_ORDERED.exec(lines[index])[1])
        index += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    if (line.trimStart().startsWith('|') && index + 1 < lines.length) {
      const separator = lines[index + 1]
      if (/^\s*\|[\s:|-]*$/.test(separator) && separator.indexOf('-') >= 0) {
        const header = splitTableRow(line)
        index += 2
        const rows = []
        while (index < lines.length && lines[index].trimStart().startsWith('|')) {
          rows.push(splitTableRow(lines[index]))
          index += 1
        }
        blocks.push({ type: 'table', header, rows })
        continue
      }
    }

    const body = []
    while (index < lines.length && lines[index].trim().length > 0 && !startsBlock(lines[index])) {
      body.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'p', text: body.join('\n') })
  }

  return blocks
}

function inlineHtml(text) {
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g
  let html = ''
  let last = 0
  let match = pattern.exec(text)

  while (match !== null) {
    html += escapeHtml(text.slice(last, match.index))
    if (match[1] !== undefined) {
      html += '<code>' + escapeHtml(match[1]) + '</code>'
    } else if (match[2] !== undefined) {
      html += '<strong>' + escapeHtml(match[2]) + '</strong>'
    } else if (match[3] !== undefined) {
      html += '<strong>' + escapeHtml(match[3]) + '</strong>'
    } else if (match[4] !== undefined) {
      html += '<em>' + escapeHtml(match[4]) + '</em>'
    } else {
      const href = safeHref(match[6])
      if (href === null) {
        html += escapeHtml(match[0])
      } else {
        html +=
          '<a href="' +
          escapeHtml(href) +
          '" target="_blank" rel="noreferrer noopener">' +
          escapeHtml(match[5]) +
          '</a>'
      }
    }
    last = match.index + match[0].length
    match = pattern.exec(text)
  }

  return html + escapeHtml(text.slice(last))
}

function renderMarkdown(source) {
  const blocks = parseMarkdown(source)
  return blocks
    .map((block) => {
      if (block.type === 'code') {
        return '<pre><code>' + escapeHtml(block.text) + '</code></pre>'
      }
      if (block.type === 'heading') {
        const level = Math.min(block.level, 6)
        return '<h' + level + '>' + inlineHtml(block.text) + '</h' + level + '>'
      }
      if (block.type === 'hr') {
        return '<hr>'
      }
      if (block.type === 'quote') {
        return '<blockquote>' + inlineHtml(block.text) + '</blockquote>'
      }
      if (block.type === 'ul' || block.type === 'ol') {
        const items = block.items.map((item) => '<li>' + inlineHtml(item) + '</li>').join('')
        return '<' + block.type + '>' + items + '</' + block.type + '>'
      }
      if (block.type === 'table') {
        const head = block.header.map((cell) => '<th>' + inlineHtml(cell) + '</th>').join('')
        const body = block.rows
          .map((row) => '<tr>' + row.map((cell) => '<td>' + inlineHtml(cell) + '</td>').join('') + '</tr>')
          .join('')
        return (
          '<div class="md-tablewrap"><table class="md-table"><thead><tr>' +
          head +
          '</tr></thead><tbody>' +
          body +
          '</tbody></table></div>'
        )
      }
      return '<p>' + inlineHtml(block.text) + '</p>'
    })
    .join('')
}

/* ------------------------------------------------------ 输入语法高亮 */

function highlightInlineHtml(line) {
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g
  let html = ''
  let last = 0
  let match = pattern.exec(line)

  while (match !== null) {
    html += escapeHtml(line.slice(last, match.index))
    if (match[1] !== undefined) {
      html += '<span class="hl-code">' + escapeHtml(match[0]) + '</span>'
    } else if (match[2] !== undefined || match[3] !== undefined) {
      const mark = match[2] !== undefined ? '**' : '__'
      const body = match[2] !== undefined ? match[2] : match[3]
      html +=
        '<span class="hl-marker">' +
        mark +
        '</span>' +
        escapeHtml(body) +
        '<span class="hl-marker">' +
        mark +
        '</span>'
    } else if (match[4] !== undefined) {
      html +=
        '<span class="hl-marker">*</span>' + escapeHtml(match[4]) + '<span class="hl-marker">*</span>'
    } else {
      html +=
        '<span class="hl-marker">[</span>' +
        '<span class="hl-link">' +
        escapeHtml(match[5]) +
        '</span>' +
        '<span class="hl-marker">](' +
        escapeHtml(match[6]) +
        ')</span>'
    }
    last = match.index + match[0].length
    match = pattern.exec(line)
  }

  return html + escapeHtml(line.slice(last))
}

function highlightSource(text) {
  const lines = String(text).split('\n')
  let html = ''
  let inCode = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (index > 0) html += '\n'

    if (/^\s*(```|~~~)/.test(line)) {
      html += '<span class="hl-marker">' + escapeHtml(line) + '</span>'
      inCode = !inCode
      continue
    }
    if (inCode) {
      html += '<span class="hl-code">' + escapeHtml(line) + '</span>'
      continue
    }

    const heading = /^(#{1,6})(\s+)(.*)$/.exec(line)
    if (heading !== null) {
      html +=
        '<span class="hl-marker">' +
        escapeHtml(heading[1]) +
        '</span><span class="hl-heading">' +
        escapeHtml(heading[2] + heading[3]) +
        '</span>'
      continue
    }

    const marker = /^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|\|\s*))/.exec(line)
    if (marker !== null && marker[1].length > 0) {
      html +=
        '<span class="hl-marker">' +
        escapeHtml(marker[1]) +
        '</span>' +
        highlightInlineHtml(line.slice(marker[1].length))
      continue
    }

    html += highlightInlineHtml(line)
  }

  return html + '\n'
}

/** OCR 只有 DeepSeek 官方接口提供，其它兼容地址一律关闭图片功能 */
function usesDeepSeekEndpoint() {
  const raw = String(config.baseURL || '').trim()
  if (raw.length === 0) return true
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host === 'api.deepseek.com' || host.endsWith('.api.deepseek.com')
  } catch (error) {
    return false
  }
}

const OCR_UNSUPPORTED = '当前接口地址不支持图片识别，请改用 https://api.deepseek.com'

/* ------------------------------------------------------------ 本地存储 */

function readStore(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 浏览器拒绝存储时忽略
  }
}

function removeStore(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // 忽略
  }
}

/** 读取 JSON 形式的缓存，坏了就当没有 */
function readJsonStore(key) {
  const raw = readStore(key)
  if (raw === null || raw.length === 0) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJsonStore(key, value) {
  writeStore(key, JSON.stringify(value))
}

function loadPersisted() {
  try {
    const raw = readStore(KEYS.settings)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.apiKey === 'string') config.apiKey = parsed.apiKey
      if (typeof parsed.baseURL === 'string' && parsed.baseURL.trim().length > 0) {
        config.baseURL = parsed.baseURL.trim()
      }
      if (typeof parsed.model === 'string' && parsed.model.trim().length > 0) config.model = parsed.model.trim()
    }
  } catch {
    // 忽略损坏的设置
  }

  try {
    const raw = readStore(KEYS.terms)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        state.terms = parsed
          .filter((item) => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 240))
          .slice(0, MAX_TERMS)
      }
    }
  } catch {
    state.terms = []
  }

  state.autoCopy = readStore(KEYS.autoCopy) === '1'
  state.immediate = readStore(KEYS.immediate) === '1'
  state.termsOpen = readStore(KEYS.termsOpen) !== '0'
  // 译文视图不持久化：每次启动都是「预览」
  state.view = 'preview'
  removeStore(KEYS.view)

  const savedTheme = readStore(KEYS.theme)
  state.theme = THEMES.some((item) => item.id === savedTheme) ? savedTheme : 'auto'

  const savedSource = readStore(KEYS.sourceLang)
  state.sourceLang = LANGS.includes(savedSource) ? savedSource : DEFAULT_SOURCE_LANG
  const savedTarget = readStore(KEYS.targetLang)
  state.targetLang = LANGS.includes(savedTarget) ? savedTarget : DEFAULT_TARGET_LANG

  state.selectedModel = config.model
}

function saveSettings() {
  writeStore(KEYS.settings, JSON.stringify(config))
}

/* -------------------------------------------------------------- 组合请求 */

function composeSource(text, terms, target) {
  const blocks = [taskBrief(target)]
  if (terms.length > 0) {
    blocks.push('【术语提示（翻译时必须优先遵守）】\n' + terms.map((term) => '- ' + term).join('\n'))
  }
  blocks.push('【待翻译原文】\n' + text)
  return blocks.join('\n\n')
}

function termsSignature() {
  return state.terms.join('\u0000')
}

/* ---------------------------------------------------------------- 渲染 */

function isStale() {
  return (
    state.output.length > 0 &&
    (state.input.trim() !== state.translatedText ||
      termsSignature() !== state.translatedTerms ||
      state.selectedModel !== state.translatedModel ||
      state.sourceLang !== state.translatedSource ||
      state.targetLang !== state.translatedTarget)
  )
}

function renderChrome() {  const loading = state.phase === 'loading'
  const ocrBusy = state.ocrBusy

  el.translate.disabled = state.input.trim().length === 0 || loading || ocrBusy
  el.translate.textContent = loading ? '翻译中…' : '翻译'
  el.clear.disabled = (state.input.length === 0 && state.image === null) || ocrBusy
  el['pick-image'].hidden = !usesDeepSeekEndpoint()
  el['pick-image'].disabled = ocrBusy || loading
  // 非 DeepSeek 地址没有余额接口
  if (!usesDeepSeekEndpoint()) setBalanceVisible(false)
  el['balance-progress'].hidden = !state.balanceBusy
  el['image-refresh'].hidden = !state.ocrDone
  el['image-refresh'].disabled = ocrBusy || loading
  el['image-refresh'].classList.toggle('is-spinning', ocrBusy)
  el['ocr-status'].hidden = state.ocrMessage.length === 0
  el['ocr-status'].textContent = state.ocrMessage
  el['ocr-status'].classList.toggle('error', state.ocrError)

  el['image-preview'].hidden = state.image === null
  if (state.image !== null) {
    el['image-name'].textContent = state.image.name
    el['image-size'].textContent =
      state.image.width > 0 ? state.image.width + ' × ' + state.image.height : ''
  }

  el['char-count'].textContent = state.input.length + ' 字符'
  el.progress.hidden = !loading
  el['ocr-progress'].hidden = !ocrBusy
  el.stale.hidden = !isStale()

  el.copy.disabled = state.output.length === 0
  el.copy.textContent =
    state.copyState === 'ok' ? '已复制' : state.copyState === 'fail' ? '复制失败' : '复制'
  el.copy.className = 'btn' + (state.copyState === 'ok' ? ' btn-ok' : state.copyState === 'fail' ? ' btn-fail' : '')

  el['view-toggle'].disabled = state.output.length === 0
  el['view-toggle'].textContent = state.view === 'preview' ? 'Markdown' : '预览'

  el['auto-copy'].setAttribute('aria-checked', String(state.autoCopy))
  el['auto-copy'].classList.toggle('on', state.autoCopy)

  el['immediate'].setAttribute('aria-checked', String(state.immediate))
  el['immediate'].classList.toggle('on', state.immediate)

  el.settings.hidden = !state.settingsOpen
  el['settings-toggle'].setAttribute('aria-expanded', String(state.settingsOpen))
  el['settings-dot'].hidden = config.apiKey.length > 0

  el['terms-toggle'].textContent = state.termsOpen ? '收起' : '展开'
  el['terms-body'].hidden = !state.termsOpen
  el['term-count'].textContent = String(state.terms.length)
  el['term-clear'].disabled = state.terms.length === 0
  el['term-add'].disabled = !(
    state.termSource.trim().length > 0 &&
    state.termTarget.trim().length > 0 &&
    state.terms.length < MAX_TERMS
  )
}

/* ---------------------------------------------------------------- 用量 */

/** 数字加千分位，例如 2626595 → 2,626,595 */
function formatTokens(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}

/** 接口地址 → 提供方名字，用于明细里的「提供方 / 模型」 */
function providerLabel() {
  const base = String(config.baseURL || '')
  if (base.indexOf('deepseek.com') !== -1) return 'deepseek'
  try {
    return new URL(base).hostname || '自定义'
  } catch {
    return '自定义'
  }
}

/** 记录一次翻译的 usage，并刷新胶囊与浮层 */
function recordUsage(payload) {
  const usage = payload && payload.usage && typeof payload.usage === 'object' ? payload.usage : null
  if (usage === null) {
    state.usage = null
    renderUsage()
    return
  }

  const prompt = Number(usage.prompt_tokens) || 0
  const completion = Number(usage.completion_tokens) || 0
  const total = Number(usage.total_tokens) || prompt + completion
  const hit = Number(usage.prompt_cache_hit_tokens) || 0
  const miss = Number(usage.prompt_cache_miss_tokens) || 0
  const hasCache =
    usage.prompt_cache_hit_tokens !== undefined || usage.prompt_cache_miss_tokens !== undefined

  state.usage = {
    model: typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : config.model,
    provider: providerLabel(),
    prompt,
    completion,
    total,
    hit,
    miss,
    hasCache,
    hitRate: prompt > 0 ? hit / prompt : null,
  }
  state.usageTotal += total
  state.usageCount += 1
  renderUsage()
}

function renderUsage() {
  const usage = state.usage
  if (usage === null) {
    el['usage-foot'].hidden = true
    closeUsagePop()
    return
  }

  el['usage-foot'].hidden = false
  el['usage-chip-text'].textContent = formatTokens(usage.total) + ' tok'
  el['usage-pop-total'].textContent = formatTokens(usage.total) + ' tok'

  const rows = [['提供方 / 模型', usage.provider + ' / ' + usage.model]]
  if (usage.hasCache) {
    rows.push(['缓存命中', usage.hitRate === null ? '—' : (usage.hitRate * 100).toFixed(1) + '%'])
    rows.push(['未缓存输入', formatTokens(usage.miss) + ' tok'])
    rows.push(['缓存读取', formatTokens(usage.hit) + ' tok'])
  } else {
    rows.push(['输入', formatTokens(usage.prompt) + ' tok'])
  }
  rows.push(['输出', formatTokens(usage.completion) + ' tok'])

  const frag = document.createDocumentFragment()
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'usage-row'
    const key = document.createElement('span')
    key.className = 'usage-k'
    key.textContent = label
    const val = document.createElement('span')
    val.className = 'usage-v'
    val.textContent = value
    row.append(key, val)
    frag.appendChild(row)
  }
  el['usage-rows'].replaceChildren(frag)

  el['usage-pop-foot'].textContent =
    '本次运行累计 ' + state.usageCount + ' 次 / ' + formatTokens(state.usageTotal) + ' tok'
}

function isUsagePopOpen() {
  return !el['usage-pop'].hidden
}

function openUsagePop() {
  el['usage-pop'].hidden = false
  el['usage-chip'].setAttribute('aria-expanded', 'true')
}

function closeUsagePop() {
  el['usage-pop'].hidden = true
  el['usage-chip'].setAttribute('aria-expanded', 'false')
}

function renderOutput() {
  const key = state.phase + '|' + state.view + '|' + state.output + '|' + state.message
  if (key === state.outputKey) return
  state.outputKey = key
  const out = el.output
  out.classList.remove('is-empty')

  if (state.phase === 'error') {
    out.classList.remove('md-mode')
    const box = document.createElement('div')
    box.className = 'error'
    const text = document.createElement('div')
    text.textContent = state.message
    box.appendChild(text)
    const retry = document.createElement('wa-button')
    retry.setAttribute('appearance', 'plain')
    retry.textContent = '重试'
    retry.addEventListener('click', () => void run())
    box.appendChild(retry)
    out.replaceChildren(box)
    return
  }

  if (state.output.length === 0) {
    out.classList.remove('md-mode')
    out.classList.add('is-empty')
    const span = document.createElement('span')
    span.className = 'placeholder'
    span.textContent = state.phase === 'loading' ? '翻译中…' : '译文会显示在这里。'
    out.replaceChildren(span)
    return
  }

  if (state.view === 'source') {
    out.classList.remove('md-mode')
    const source = document.createElement('div')
    source.className = 'md-source'
    // 复用输入框的高亮器：输出是 HTML 片段，highlightSource 内部会转义
    source.innerHTML = highlightSource(state.output)
    out.replaceChildren(source)
    return
  }

  out.classList.add('md-mode')
  out.innerHTML = '<div class="md">' + renderMarkdown(state.output) + '</div>'
}

const TERM_SEPARATOR = ' 翻译成 '

/** 把「原文 翻译成 译文」拆成两段，渲染时分开显示 */
function splitTerm(term) {
  const index = term.indexOf(TERM_SEPARATOR)
  if (index < 0) return [term, '']
  return [term.slice(0, index), term.slice(index + TERM_SEPARATOR.length)]
}

function renderTerms() {
  const list = el['terms-list']
  list.replaceChildren()

  if (state.terms.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'terms-empty'
    empty.textContent = '还没有术语。添加后会随每次翻译一起发给模型。'
    list.appendChild(empty)
    return
  }

  state.terms.forEach((term, index) => {
    const row = document.createElement('div')
    row.className = 'term'

    const [sourceText, targetText] = splitTerm(term)

    const from = document.createElement('span')
    from.className = 'term-token'
    from.title = term
    from.textContent = sourceText

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'term-remove'
    remove.title = '删除'
    remove.setAttribute('aria-label', '删除')
    remove.textContent = '\u00d7'
    remove.addEventListener('click', () => {
      state.terms.splice(index, 1)
      persistTerms()
      renderTerms()
      renderChrome()
    })

    row.append(from)

    if (targetText.length > 0) {
      const arrow = document.createElement('span')
      arrow.className = 'term-arrow'
      arrow.textContent = '翻译成'

      const to = document.createElement('span')
      to.className = 'term-token'
      to.title = term
      to.textContent = targetText

      row.append(arrow, to)
    }

    row.append(remove)
    list.appendChild(row)
  })
}

function renderModels() {
  const select = el['model-select']
  select.replaceChildren()

  const list = state.models.length > 0 ? state.models : [{ id: config.model || DEFAULT_MODEL }]
  for (const item of list) {
    const option = document.createElement('wa-option')
    option.value = item.id
    option.textContent = item.id
    select.appendChild(option)
  }

  const wanted = state.selectedModel || config.model
  const exists = list.some((item) => item.id === wanted)
  const next = exists ? wanted : list[0].id
  select.value = next
  state.selectedModel = next
}

function render() {
  renderChrome()
  renderOutput()
}

function renderAll() {
  renderChrome()
  renderOutput()
  renderTerms()
  renderModels()
}

/* ------------------------------------------------------------ 输入同步 */

let highlightFrame = 0

function syncHighlight() {
  if (highlightFrame !== 0) return
  highlightFrame = window.requestAnimationFrame(() => {
    highlightFrame = 0
    el.hl.innerHTML = highlightSource(state.input)
    el.hl.scrollTop = el.source.scrollTop
    el.hl.scrollLeft = el.source.scrollLeft
  })
}

/* ---------------------------------------------------------------- 复制 */

function legacyCopy(text) {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}

async function copyText(text) {
  if (text.length === 0) return false
  let copied = false
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      copied = true
    }
  } catch {
    copied = false
  }
  if (!copied) copied = legacyCopy(text)

  state.copyState = copied ? 'ok' : 'fail'
  renderChrome()
  if (state.copyTimer !== 0) clearTimeout(state.copyTimer)
  state.copyTimer = window.setTimeout(() => {
    state.copyTimer = 0
    state.copyState = 'idle'
    renderChrome()
  }, COPIED_MS)
  return copied
}

/* ---------------------------------------------------------------- 翻译 */

async function run() {
  const text = state.input.trim()
  if (text.length === 0 || state.phase === 'loading') return

  // 原文和译文语言相同时没有翻译的意义，直接提醒
  if (state.sourceLang === state.targetLang) {
    showToast(`原文和译文都是${state.targetLang}，改一下其中一边再翻译。`, 'warn')
    return
  }

  if (config.apiKey.length === 0) {
    state.settingsOpen = true
    renderChrome()
    el['settings-hint'].textContent = '请先填写 API Key，再翻译。'
    el['api-key'].focus()
    // 设置面板可能被折叠或滚出视野，再补一条 Toast，避免用户以为按钮没反应
    showToast('未提供 API Key，请提供后再翻译。', 'warn')
    return
  }

  const runId = state.runId + 1
  state.runId = runId

  const model = state.selectedModel || config.model

  // 同一段文本（且术语、模型、语言都没变）已经有结果了，就不再重复发请求
  if (
    state.phase === 'done' &&
    state.output.length > 0 &&
    text === state.translatedText &&
    termsSignature() === state.translatedTerms &&
    model === state.translatedModel &&
    state.sourceLang === state.translatedSource &&
    state.targetLang === state.translatedTarget
  ) {
    return
  }

  state.phase = 'loading'
  state.message = ''
  render()

  try {
    const payload = await invokeTauri('translate', {
      text: composeSource(text, state.terms, state.targetLang),
      source: state.sourceLang,
      target: state.targetLang,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model,
    })
    if (runId !== state.runId) return
    if (payload === null || payload === undefined || payload.ok !== true) {
      throw new Error(localizeError(payload?.error, '翻译失败，请稍后重试。'))
    }

    state.output = typeof payload.translation === 'string' ? payload.translation : ''
    state.translatedText = text
    state.translatedTerms = termsSignature()
    state.translatedModel = typeof payload.model === 'string' ? payload.model : model
    state.translatedSource = state.sourceLang
    state.translatedTarget = state.targetLang
    state.phase = 'done'
    state.copyState = 'idle'
    recordUsage(payload)
    render()
    void refreshBalance()

    if (state.autoCopy && state.output.length > 0) await copyText(state.output)
  } catch (error) {
    if (runId !== state.runId) return
    state.phase = 'error'
    const raw = error !== null && error !== undefined && error.message ? String(error.message) : String(error)
    state.message = hasChinese(raw) ? raw : '翻译失败，请稍后重试。'
    console.error(error)
    render()
  }
}

/* ------------------------------------------------------------ 术语操作 */

function persistTerms() {
  writeStore(KEYS.terms, JSON.stringify(state.terms))
}

function addTerm() {
  const source = state.termSource.trim()
  const target = state.termTarget.trim()
  if (source.length === 0 || target.length === 0 || state.terms.length >= MAX_TERMS) return

  const entry = source + ' 翻译成 ' + target
  if (!state.terms.includes(entry)) state.terms.push(entry)

  state.termSource = ''
  state.termTarget = ''
  el['term-source'].value = ''
  el['term-target'].value = ''
  el['term-source'].focus()

  persistTerms()
  renderTerms()
  renderChrome()
}

/* ------------------------------------------------------------ 余额显示 */

/**
 * 查询并显示账户余额。DeepSeek 官方接口是 GET /user/balance；
 * 其它 OpenAI 兼容服务通常没有这个接口，失败时就隐藏，不打扰用户。
 */
async function refreshBalance(manual = false) {
  // 用户主动点击余额时才显示进度条，自动刷新不打扰
  const startedAt = Date.now()
  if (manual) {
    state.balanceBusy = true
    renderChrome()
  }

  try {
    // 余额接口只有 DeepSeek 官方提供，其它地址直接关掉
    if (!usesDeepSeekEndpoint()) {
      setBalanceVisible(false)
      return
    }
    if (config.apiKey.length === 0) {
      setBalanceVisible(false)
      return
    }

    // 只有还没有数值时才摆占位；已经显示着余额时刷新，保持原数字不动，
    // 否则每点一次刷新都会先闪一下「余额 --」
    if (el.balance.classList.contains('is-placeholder') || el['balance-wrap'].hidden) {
      showBalancePlaceholder()
    }

    const payload = await invokeTauri('balance', { apiKey: config.apiKey, baseURL: config.baseURL })
    if (payload === null || payload === undefined || payload.ok !== true) {
      // 拿不到就留着旧数字（或占位）不动，只改提示，避免布局和数值回弹
      el.balance.title = '读取余额失败，点击重试'
      return
    }
    if (typeof payload.total !== 'string' || payload.total.length === 0) {
      el.balance.title = '读取余额失败，点击重试'
      return
    }

    const symbol =
      payload.currency === 'USD' ? '$' : payload.currency === 'CNY' ? '¥' : String(payload.currency || '') + ' '
    el.balance.classList.remove('is-placeholder')
    el.balance.textContent = '余额 ' + symbol + payload.total
    el.balance.title =
      '充值 ' + (payload.toppedUp || '0') + ' · 赠送 ' + (payload.granted || '0') + '（点击刷新）'
    // 余额偏低时变色提醒：< 3 橙色，< 2 红色，不可用直接红色
    const total = Number.parseFloat(payload.total)
    const hasTotal = Number.isFinite(total)
    el.balance.variant =
      payload.available === false || (hasTotal && total < BALANCE_DANGER)
        ? 'danger'
        : hasTotal && total < BALANCE_WARN
          ? 'warning'
          : 'brand'
    // 缓存结果，下次启动先显示这个数字，再去请求最新值
    writeJsonStore(KEYS.balance, {
      text: el.balance.textContent,
      title: el.balance.title,
      variant: el.balance.variant,
      savedAt: Date.now(),
    })
    setBalanceVisible(true)
  } finally {
    if (manual) {
      // 请求太快时进度条一闪而过，补足到 1 秒再收起
      const elapsed = Date.now() - startedAt
      if (elapsed < BALANCE_MIN_PROGRESS_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, BALANCE_MIN_PROGRESS_MS - elapsed))
      }
      state.balanceBusy = false
      renderChrome()
    }
  }
}

/** 余额和它左边的分隔线一起显示 / 隐藏 */
function setBalanceVisible(visible) {
  if (el['balance-wrap'] !== undefined && el['balance-wrap'] !== null) {
    el['balance-wrap'].hidden = !visible
  }
  el.balance.hidden = false
  if (el['balance-divider'] !== undefined && el['balance-divider'] !== null) {
    el['balance-divider'].hidden = !visible
  }
}

/**
 * 余额是异步读回来的，先用同宽的占位撑住工具栏，
 * 免得数值到达时整排控件（模型 / 主题 / 设置）被顶得跳一下。
 */
function showBalancePlaceholder() {
  el.balance.classList.add('is-placeholder')
  el.balance.textContent = '余额 --'
  el.balance.title = '正在读取余额…'
  setBalanceVisible(true)
}

/** 启动时先把上次缓存的余额显示出来，联网后再无缝更新 */
function applyCachedBalance() {
  const cached = readJsonStore(KEYS.balance)
  if (cached === null || typeof cached.text !== 'string' || cached.text.length === 0) return false
  el.balance.textContent = cached.text
  el.balance.title = cached.title || '（点击刷新）'
  if (typeof cached.variant === 'string' && cached.variant.length > 0) {
    el.balance.variant = cached.variant
  }
  el.balance.classList.remove('is-placeholder')
  setBalanceVisible(true)
  return true
}

/* ------------------------------------------------------------ 设置与模型 */

async function refreshModels() {
  if (config.apiKey.length === 0) {
    state.models = []
    renderModels()
    el['settings-hint'].textContent = '填写 API Key 后会自动读取可用模型。'
    return
  }

  el['settings-hint'].textContent = '正在读取模型列表…'
  try {
    const payload = await invokeTauri('models', { apiKey: config.apiKey, baseURL: config.baseURL })
    if (payload !== null && payload !== undefined && payload.ok === true && Array.isArray(payload.models)) {
      state.models = payload.models
      // 缓存一份，下次启动先用它把下拉框填上，不用等网络
      writeJsonStore(KEYS.models, { list: payload.models, savedAt: Date.now() })
      el['settings-hint'].textContent =
        payload.models.length > 0 ? '已读取 ' + payload.models.length + ' 个模型。' : '接口没有返回模型列表，将使用默认模型。'
    } else {
      el['settings-hint'].textContent =
        '模型列表读取失败：' + localizeError(payload?.error, '请检查 API Key 和接口地址。')
    }
  } catch (error) {
    el['settings-hint'].textContent = '模型列表读取失败：请检查网络后重试。'
  }
  renderModels()
}

/** 启动时先用上次缓存的模型列表渲染，避免下拉框空着 */
function applyCachedModels() {
  const cached = readJsonStore(KEYS.models)
  if (cached === null || !Array.isArray(cached.list) || cached.list.length === 0) return false
  state.models = cached.list
  renderModels()
  return true
}

/* ---------------------------------------------------------------- 绑定 */

/**
 * 判断右键是否落在可输入的控件上（含 Web Awesome 组件 shadow DOM 里的原生 input）。
 * 落在这里就放行浏览器菜单，方便用系统菜单里的「粘贴」。
 */
function isEditableTarget(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  const TEXT_TYPES = new Set(['text', 'password', 'search', 'url', 'email', 'number', 'tel'])
  for (const node of path) {
    if (node === null || node === undefined || typeof node.tagName !== 'string') continue
    const tag = node.tagName.toUpperCase()
    if (tag === 'TEXTAREA') return true
    if (tag === 'INPUT') {
      const type = String(node.getAttribute('type') || 'text').toLowerCase()
      return TEXT_TYPES.has(type)
    }
    if (node.isContentEditable === true) return true
  }
  return false
}

function bind() {
  // 只保留输入框里的右键菜单（为了粘贴），其它地方的浏览器菜单一律屏蔽
  document.addEventListener('contextmenu', (event) => {
    if (isEditableTarget(event)) return
    event.preventDefault()
  })
  el['usage-chip'].addEventListener('click', (event) => {
    event.stopPropagation()
    if (isUsagePopOpen()) {
      closeUsagePop()
    } else {
      openUsagePop()
    }
  })

  document.addEventListener('click', (event) => {
    if (!isUsagePopOpen()) return
    if (el['usage-foot'].contains(event.target)) return
    closeUsagePop()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isUsagePopOpen()) closeUsagePop()
  })

  el.source.addEventListener('input', () => {
    state.input = el.source.value
    syncHighlight()

    if (state.input.length === 0) {
      state.runId += 1
      state.output = ''
      state.phase = 'idle'
      state.message = ''
      state.translatedText = ''
      state.translatedTerms = ''
      state.translatedModel = ''
      state.translatedSource = ''
      state.translatedTarget = ''
      render()
      return
    }

    renderChrome()
  })

  el.source.addEventListener('scroll', () => {
    el.hl.scrollTop = el.source.scrollTop
    el.hl.scrollLeft = el.source.scrollLeft
  })

  // 勾选「粘贴后翻译」后，粘贴完成即触发一次翻译；粘贴图片时走 OCR
  el.source.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items ?? []
    for (const item of items) {
      if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
        const file = item.getAsFile()
        if (file !== null) {
          event.preventDefault()
          if (!usesDeepSeekEndpoint()) {
            ocrFail(OCR_UNSUPPORTED)
            return
          }
          void handleImageFile(file, 'paste')
          return
        }
      }
    }

    if (!state.immediate) return
    window.setTimeout(() => {
      state.input = el.source.value
      syncHighlight()
      renderChrome()
      if (state.input.trim().length > 0) void run()
    }, 0)
  })

  el['pick-image'].addEventListener('click', () => el['image-input'].click())

  el['image-input'].addEventListener('change', () => {
    const file = el['image-input'].files?.[0] ?? null
    el['image-input'].value = ''
    if (file !== null) void handleImageFile(file, 'file')
  })

  el['image-thumb'].addEventListener('click', () => void openVerify())
  el['image-refresh'].addEventListener('click', refreshOcr)
  el['image-zoom'].addEventListener('click', () => void openVerify())

  el['verify-overlay'].addEventListener('click', (event) => {
    if (event.target === el['verify-overlay']) closeVerify()
  })
  el['verify-save'].addEventListener('click', saveVerify)
  el['verify-close'].addEventListener('click', () => closeVerify())
  el['verify-view'].addEventListener('click', () => {
    verifyView = verifyView === 'preview' ? 'edit' : 'preview'
    renderVerifyView()
    if (verifyView === 'edit') el['verify-editor'].focus()
  })
  el['confirm-keep'].addEventListener('click', () => {
    el['verify-confirm'].hidden = true
  })
  el['confirm-discard'].addEventListener('click', () => {
    el['verify-confirm'].hidden = true
    closeVerify(true)
  })

  /* 图片区域：滚轮缩放 + 拖拽平移（缩放控件与关闭按钮上的操作不参与） */
  const stage = el['verify-stage']
  const isStageControl = (target) =>
    target instanceof Element && target.closest('.verify-zoom, .verify-head-close') !== null

  stage.addEventListener(
    'wheel',
    (event) => {
      if (isStageControl(event.target)) return
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const originX = event.clientX - rect.left - rect.width / 2
      const originY = event.clientY - rect.top - rect.height / 2
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      setVerifyZoom(verifyZoom * factor, originX, originY)
    },
    { passive: false },
  )

  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let panStartX = 0
  let panStartY = 0

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    // 点控件时不要抢指针，否则 setPointerCapture 会让按钮收不到 click
    if (isStageControl(event.target)) return
    dragging = true
    dragStartX = event.clientX
    dragStartY = event.clientY
    panStartX = verifyPanX
    panStartY = verifyPanY
    stage.classList.add('is-dragging')
    stage.setPointerCapture?.(event.pointerId)
  })

  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return
    verifyPanX = panStartX + (event.clientX - dragStartX)
    verifyPanY = panStartY + (event.clientY - dragStartY)
    applyVerifyTransform()
  })

  const endDrag = (event) => {
    if (!dragging) return
    dragging = false
    stage.classList.remove('is-dragging')
    stage.releasePointerCapture?.(event.pointerId)
  }

  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)
  stage.addEventListener('dblclick', (event) => {
    if (isStageControl(event.target)) return
    resetVerifyZoom()
  })

  el['zoom-in'].addEventListener('click', () => setVerifyZoom(verifyZoom * 1.25))
  el['zoom-out'].addEventListener('click', () => setVerifyZoom(verifyZoom / 1.25))
  el['zoom-reset'].addEventListener('click', resetVerifyZoom)

  el['image-thumb'].addEventListener('load', () => {
    if (state.image === null) return
    state.image.width = el['image-thumb'].naturalWidth
    state.image.height = el['image-thumb'].naturalHeight
    el['image-size'].textContent = state.image.width + ' × ' + state.image.height
  })

  el.source.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void run()
    }
  })

  el.translate.addEventListener('click', () => void run())
  el.clear.addEventListener('click', () => {
    state.runId += 1
    state.input = ''
    state.output = ''
    state.phase = 'idle'
    state.message = ''
    state.translatedText = ''
    state.translatedTerms = ''
    state.translatedModel = ''
    state.translatedSource = ''
    state.translatedTarget = ''
    state.ocrMessage = ''
    state.ocrError = false
    el.source.value = ''
    clearImage()
    syncHighlight()
    render()
    el.source.focus()
  })

  el.copy.addEventListener('click', () => void copyText(state.output))

  el['view-toggle'].addEventListener('click', () => {
    state.view = state.view === 'preview' ? 'source' : 'preview'
    render()
  })

  el['auto-copy'].addEventListener('click', () => {
    state.autoCopy = !state.autoCopy
    writeStore(KEYS.autoCopy, state.autoCopy ? '1' : '0')
    renderChrome()
  })

  el['immediate'].addEventListener('click', () => {
    state.immediate = !state.immediate
    writeStore(KEYS.immediate, state.immediate ? '1' : '0')
    renderChrome()
  })

  el['terms-toggle'].addEventListener('click', () => {
    state.termsOpen = !state.termsOpen
    writeStore(KEYS.termsOpen, state.termsOpen ? '1' : '0')
    renderChrome()
  })

  el['term-clear'].addEventListener('click', () => {
    if (state.terms.length === 0) return
    state.confirmClear = true
    el['confirm-modal'].open = true
  })

  el['confirm-modal'].addEventListener('wa-after-hide', () => {
    state.confirmClear = false
  })

  el['confirm-cancel'].addEventListener('click', () => {
    el['confirm-modal'].open = false
  })

  el['confirm-ok'].addEventListener('click', () => {
    state.terms = []
    persistTerms()
    renderTerms()
    renderChrome()
    el['confirm-modal'].open = false
  })

  el['term-source'].addEventListener('input', () => {
    state.termSource = el['term-source'].value
    renderChrome()
  })
  el['term-target'].addEventListener('input', () => {
    state.termTarget = el['term-target'].value
    renderChrome()
  })
  for (const input of [el['term-source'], el['term-target']]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        addTerm()
      }
    })
  }
  el['term-add'].addEventListener('click', addTerm)

  el['settings-toggle'].addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen
    renderChrome()
  })

  el['close-settings'].addEventListener('click', () => {
    state.settingsOpen = false
    renderChrome()
  })

  el['save-settings'].addEventListener('click', () => {
    const previousKey = config.apiKey
    const previousBase = config.baseURL
    config.apiKey = el['api-key'].value.trim()
    const base = el['base-url'].value.trim()
    config.baseURL = base.length > 0 ? base : DEFAULT_BASE_URL
    saveSettings()
    // 换了 Key 或接口地址，旧缓存就属于另一个账号了，先清掉免得显示错数据
    if (config.apiKey !== previousKey || config.baseURL !== previousBase) {
      removeStore(KEYS.models)
      removeStore(KEYS.balance)
    }
    // 换成不支持 OCR 的地址时，把已经选的图片也清掉
    if (!usesDeepSeekEndpoint() && state.image !== null) clearImage()
    renderChrome()
    void refreshModels()
    void refreshBalance()
  })

  el['balance'].addEventListener('click', () => void refreshBalance(true))

  el['theme-select'].addEventListener('change', () => {
    applyTheme(el['theme-select'].value)
    writeStore(KEYS.theme, state.theme)
  })

  el['source-lang'].addEventListener('change', () => {
    state.sourceLang = el['source-lang'].value
    writeStore(KEYS.sourceLang, state.sourceLang)
    renderChrome()
  })

  el['target-lang'].addEventListener('change', () => {
    state.targetLang = el['target-lang'].value
    writeStore(KEYS.targetLang, state.targetLang)
    renderChrome()
  })

  bindWindowControls()

  el['model-select'].addEventListener('change', () => {
    state.selectedModel = el['model-select'].value
    config.model = state.selectedModel
    saveSettings()
    renderChrome()
  })
}

/* ------------------------------------------------------------ 图片识别 */

/** 单张图片上限，超过直接拒绝（OCR 接口本身允许 100 MiB，但上传很慢） */
const OCR_MAX_BYTES = 20 * 1024 * 1024

function setOcrStatus(message, isError = false) {
  state.ocrMessage = message
  state.ocrError = isError
  renderChrome()
}

/** 识别期间每秒更新一次已用时间，避免长时间没有反馈 */
let ocrTicker = 0

function startOcrTicker() {
  const startedAt = Date.now()
  stopOcrTicker()
  ocrTicker = window.setInterval(() => {
    if (!state.ocrBusy) {
      stopOcrTicker()
      return
    }
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    state.ocrMessage = '正在识别图片… ' + seconds + 's'
    el['ocr-status'].textContent = state.ocrMessage
  }, 1000)
}

function stopOcrTicker() {
  if (ocrTicker !== 0) {
    window.clearInterval(ocrTicker)
    ocrTicker = 0
  }
}

/** 文件读成 base64（去掉 data: 前缀） */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** OCR 输出里会带 <｜ref｜>、<｜box｜>[[x1,y1,x2,y2]]<｜/box｜> 这类定位标记，去掉 */
function cleanupOcrText(raw) {
  return String(raw ?? '')
    .replace(/<｜box｜>\[\[[^\]]*\]\]<｜\/box｜>/g, '')
    .replace(/<｜ref｜>/g, '')
    .replace(/<｜\/ref｜>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 把图片显示到预览条（OCR 完成后仍然保留，方便对照）。用 data URL，跨页面也能带过去 */
function showImage(dataUrl, name, source) {
  state.image = { dataUrl, name: name || 'clipboard.png', source, width: 0, height: 0 }
  state.ocrDone = false
  el['image-thumb'].src = dataUrl
  renderChrome()
}

function clearImage() {
  state.image = null
  state.ocrDone = false
  el['image-thumb'].removeAttribute('src')
  renderChrome()
}

/** 校验弹窗里图片的缩放/平移状态 */
let verifyZoom = 1
let verifyPanX = 0
let verifyPanY = 0

function applyVerifyTransform() {
  el['verify-image'].style.transform =
    'translate(' + verifyPanX + 'px, ' + verifyPanY + 'px) scale(' + verifyZoom + ')'
  el['zoom-value'].textContent = Math.round(verifyZoom * 100) + '%'
}

/** 以 (originX, originY) 为中心缩放，坐标是相对舞台中心的偏移 */
function setVerifyZoom(next, originX = 0, originY = 0) {
  const clamped = Math.min(8, Math.max(0.2, next))
  const ratio = clamped / verifyZoom
  verifyPanX = originX - (originX - verifyPanX) * ratio
  verifyPanY = originY - (originY - verifyPanY) * ratio
  verifyZoom = clamped
  applyVerifyTransform()
}

function resetVerifyZoom() {
  verifyZoom = 1
  verifyPanX = 0
  verifyPanY = 0
  applyVerifyTransform()
}

/** 校验弹窗的编辑 / 预览模式 */
let verifyView = 'edit'

function renderVerifyView() {
  const previewing = verifyView === 'preview'
  el['verify-editor'].hidden = previewing
  el['verify-preview'].hidden = !previewing
  el['verify-view'].textContent = previewing ? '编辑' : '预览'
  if (previewing) {
    el['verify-preview'].innerHTML = '<div class="md">' + renderMarkdown(el['verify-editor'].value) + '</div>'
  }
}

/** 打开校验弹窗：整页大小的浮层，上面看图片、下面改文字 */
function openVerify() {
  if (state.image === null) return
  el['verify-image'].src = state.image.dataUrl
  el['verify-editor'].value = state.input
  el['verify-confirm'].hidden = true
  el['verify-overlay'].hidden = false
  verifyView = 'preview'
  renderVerifyView()
  resetVerifyZoom()
}

/** 弹窗里的文字有没有改过 */
function verifyDirty() {
  return !el['verify-overlay'].hidden && el['verify-editor'].value !== state.input
}

function closeVerify(force = false) {
  if (el['verify-overlay'].hidden) return
  if (!force && verifyDirty()) {
    el['verify-confirm'].hidden = false
    return
  }
  el['verify-overlay'].hidden = true
  el['verify-confirm'].hidden = true
  el['verify-image'].removeAttribute('src')
}

/** 保存弹窗里的文字到输入框，然后关闭 */
function saveVerify() {
  const text = el['verify-editor'].value
  if (text !== state.input) {
    state.input = text
    el.source.value = text
    syncHighlight()
    render()
  }
  closeVerify(true)
}

/** 错误信息里出现这些英文原文时，统一翻成中文给用户看 */
function hasChinese(text) {
  return /[\u4e00-\u9fa5]/.test(String(text || ''))
}

/** 把 { code, message } 形式的错误翻成中文；不认识的一律用兜底中文 */
function localizeError(error, fallback) {
  const code = String(error?.code ?? '')
  const raw = String(error?.message ?? '').trim()

  if (code === 'NO_KEY') return '请先在「设置」里填写 API Key。'
  if (code === 'UNAUTHORIZED') return 'API Key 无效，请在「设置」里检查。'
  if (code === 'QUOTA') return '余额不足，请充值后再试。'
  if (code === 'RATE_LIMIT') return '请求过于频繁，请稍后再试。'
  if (code === 'NETWORK') return '网络异常，请检查网络或接口地址。'
  if (code === 'UPSTREAM') return '模型服务暂时不可用，请稍后重试。'
  if (code === 'INTERNAL') return '程序内部错误，请重试一次。'
  if (code === 'EMPTY_INPUT') return '请先输入要翻译的英文。'
  if (code === 'TOO_LONG') return '文本太长，请分段翻译。'
  if (code === 'BAD_IMAGE') return '图片数据无法解析，请重新选一张。'

  // 上游偶尔会给中文，这时候直接用
  if (hasChinese(raw)) return raw
  return fallback
}

/** Toast 提示：右上角浮块，几秒后自动消失 */
const TOAST_MS = 6000
const TOAST_MAX = 3

function showToast(message, kind = 'error') {
  const stack = el['toast-stack']
  if (stack === null || stack === undefined) return

  while (stack.children.length >= TOAST_MAX) stack.firstElementChild.remove()

  const toast = document.createElement('div')
  toast.className = 'toast toast-' + kind

  const text = document.createElement('span')
  text.className = 'toast-text'
  text.textContent = message

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'toast-close'
  close.textContent = '\u00d7'
  close.setAttribute('aria-label', '关闭提示')
  close.addEventListener('click', () => toast.remove())

  toast.append(text, close)
  stack.appendChild(toast)
  window.setTimeout(() => toast.remove(), TOAST_MS)
}

/** 把 OCR 错误翻成中文（对照官方文档的错误表） */
function ocrErrorMessage(error) {
  const code = String(error?.code ?? '')
  const raw = String(error?.message ?? '').trim()

  // 先按文档里的英文原文匹配
  if (/password-protected/i.test(raw)) return '文件有打开密码，请移除密码后重试。'
  if (/more than 1000 pages/i.test(raw)) return '文档超过 1000 页。'
  if (/too large/i.test(raw)) return '文件超过 100 MB。'
  if (/did not finish/i.test(raw)) return '识别超时，试试更小的文件。'
  if (/could not be parsed|could not be decoded|format is not supported/i.test(raw)) {
    return '文件无法解析或格式不支持。'
  }
  if (/temporarily unavailable|Internal Server Error/i.test(raw)) {
    return 'OCR 服务暂时不可用，请稍后重试。'
  }

  // 再按状态码
  if (code === 'BAD_IMAGE') return '图片数据无法解析，请重新选一张。'
  if (code === 'BAD_REQUEST') return '请求参数不合法，或文件无法处理。'
  if (code === 'UPLOAD_SLOW') return '上传过慢，请换网络或换更小的文件重试。'
  if (code === 'TOO_LARGE') return '文件超过 100 MB。'
  if (code === 'TIMEOUT') return '上传与识别超过 180 秒上限，换小一点的文件吧。'
  if (code === 'BUSY') return 'OCR 服务繁忙，请稍后重试。'
  if (code === 'UPLOAD_FAILED') return '文件上传或提交识别失败，请重试。'

  return localizeError(error, 'OCR 识别失败，请稍后重试。')
}

/** OCR 出错：行内状态 + Toast 一起提示 */
function ocrFail(message) {
  setOcrStatus(message, true)
  showToast(message)
}

/** 从 data URL 里取 mime 类型 */
function dataUrlMime(dataUrl) {
  const match = /^data:([^;,]+)/.exec(String(dataUrl || ''))
  return match ? match[1] : 'image/png'
}

/** 对给定图片跑一次 OCR，把结果写进输入框 */
async function runOcr(dataUrl, name, mime) {
  if (!usesDeepSeekEndpoint()) {
    ocrFail(OCR_UNSUPPORTED)
    return
  }
  if (config.apiKey.length === 0) {
    ocrFail('请先在「设置」里填写 API Key。')
    return
  }

  const text = String(dataUrl || '')
  const comma = text.indexOf(',')
  const data = comma >= 0 ? text.slice(comma + 1) : text
  if (data.length === 0) {
    ocrFail('图片数据为空，请重新选一张图片。')
    return
  }

  state.ocrBusy = true
  setOcrStatus('正在识别图片…')
  startOcrTicker()

  const payload = await invokeTauri('ocr', {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fileName: name || 'clipboard.png',
    mime: mime || 'image/png',
    data,
  })

  state.ocrBusy = false
  stopOcrTicker()
  // 请求有结果了（成功或失败都算），此时才显示「刷新」
  state.ocrDone = true

  if (payload === null || payload === undefined || payload.ok !== true) {
    ocrFail(ocrErrorMessage(payload?.error))
    return
  }

  const recognized = cleanupOcrText(payload.text)
  if (recognized.length === 0) {
    setOcrStatus('没有识别到文字', true)
    showToast('没有识别到文字，换一张更清晰的图片试试。')
    return
  }

  el.source.value = recognized
  state.input = recognized
  syncHighlight()
  setOcrStatus('')
  render()

  if (state.immediate) void run()
}

/** 用当前图片重新识别一次 */
function refreshOcr() {
  if (state.image === null) return
  void runOcr(state.image.dataUrl, state.image.name, dataUrlMime(state.image.dataUrl))
}

async function handleImageFile(file, source = 'file') {
  if (file === null || file === undefined) return

  if (!usesDeepSeekEndpoint()) {
    ocrFail(OCR_UNSUPPORTED)
    return
  }
  if (!String(file.type || '').startsWith('image/')) {
    ocrFail('这不是图片文件，请选 PNG / JPEG / WebP 等图片。')
    return
  }
  if (file.size > OCR_MAX_BYTES) {
    ocrFail('图片超过 20 MB，换一张小一点的。')
    return
  }
  if (config.apiKey.length === 0) {
    ocrFail('请先在「设置」里填写 API Key。')
    return
  }

  let data = ''
  try {
    data = await fileToBase64(file)
  } catch (error) {
    ocrFail('读取图片失败，请重试。')
    return
  }

  const dataUrl = 'data:' + (file.type || 'image/png') + ';base64,' + data
  showImage(dataUrl, file.name, source)
  await runOcr(dataUrl, file.name, file.type || 'image/png')
}

/* ------------------------------------------------------------ 窗口控制 */

/** 自定义标题栏的窗口按钮（关掉原生外框后自己实现） */
function bindWindowControls() {
  const appWindow = window.__TAURI__?.window?.getCurrentWindow?.() ?? null

  if (appWindow === null) {
    // 拿不到 Tauri 窗口对象时至少保证能关掉窗口
    el['win-close'].addEventListener('click', () => window.close())
    return
  }

  el['win-min'].addEventListener('click', () => void appWindow.minimize())
  el['win-max'].addEventListener('click', () => void appWindow.toggleMaximize())
  el['win-close'].addEventListener('click', () => void appWindow.close())

  const syncMaxState = async () => {
    try {
      const maximized = await appWindow.isMaximized()
      el['win-max'].classList.toggle('is-maximized', maximized)
      el['win-max'].title = maximized ? '还原' : '最大化'
    } catch (error) {
      // 拿不到状态就用默认图标
    }
  }

  void syncMaxState()
  void appWindow.onResized(() => void syncMaxState())
}

/* ---------------------------------------------------------------- 主题 */

const DARK_QUERY = window.matchMedia('(prefers-color-scheme: dark)')

/** 把主题 id 解析成实际生效的 a / b / c / d（auto 跟随系统深浅色） */
function resolveTheme(theme) {
  if (theme === 'auto') return DARK_QUERY.matches ? 'a' : 'b'
  return THEMES.some((item) => item.id === theme) ? theme : 'b'
}

/** 应用主题：切换 html 上的 data-theme，并同步 Web Awesome 的深色类 */
function applyTheme(theme) {
  const chosen = THEMES.some((item) => item.id === theme) ? theme : 'auto'
  state.theme = chosen
  const id = resolveTheme(chosen)
  document.documentElement.dataset.theme = id
  document.documentElement.classList.toggle('wa-dark', id === 'a')
}

// 选「跟随系统」时，系统深浅色一变就跟着变
DARK_QUERY.addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme('auto')
})

function renderThemeSelect() {
  const select = el['theme-select']
  select.replaceChildren()
  for (const theme of THEMES) {
    const option = document.createElement('wa-option')
    option.value = theme.id
    option.textContent = theme.name
    select.appendChild(option)
  }
  select.value = state.theme
}

/** 原文 / 译文语言下拉 */
function renderLangSelects() {
  for (const [key, current] of [
    ['source-lang', state.sourceLang],
    ['target-lang', state.targetLang],
  ]) {
    const select = el[key]
    select.replaceChildren()
    for (const lang of LANGS) {
      const option = document.createElement('wa-option')
      option.value = lang
      option.textContent = lang
      select.appendChild(option)
    }
    select.value = current
  }
}

/* ---------------------------------------------------------------- 启动 */

loadPersisted()
applyTheme(state.theme)
renderThemeSelect()
renderLangSelects()
el['api-key'].value = config.apiKey
el['base-url'].value = config.baseURL === DEFAULT_BASE_URL ? '' : config.baseURL
el['base-url'].placeholder = DEFAULT_BASE_URL
el.source.value = state.input
bind()
renderAll()
syncHighlight()
if (config.apiKey.length > 0) {
  // 先用上次缓存把界面填满（工具栏和下拉框立刻就是最终形态），再去请求最新数据
  applyCachedModels()
  if (usesDeepSeekEndpoint()) applyCachedBalance()
  void refreshModels()
  void refreshBalance()
}
