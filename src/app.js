/**
 * 英译中 · 独立版前端
 *
 * 纯原生 JS，没有构建步骤。负责：Markdown 输入高亮、Markdown 预览/源码切换、
 * 术语表、模型选择、自动复制、进度动画，以及把请求发给本机服务。
 */

/* ------------------------------------------------------------ 常量与状态 */

const MAX_TERMS = 50
const COPIED_MS = 1600

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'

const TASK_BRIEF = [
  '【本次任务（优先于其他格式要求）】',
  '先把原文整理成 Markdown，再翻译：',
  '- 并列、分步、逐条的内容用有序或无序列表；',
  '- 有明显分节的内容用标题；',
  '- 代码、命令、文件路径、接口路径、变量名用行内代码（反引号）包裹；',
  '- 纯叙述性段落保持为普通段落。',
  '只做结构整理，不许增删或改写任何信息。',
  '',
  '然后把整理出的 Markdown 翻译成简体中文：Markdown 标记和代码原样保留，代码块里的代码不翻译。',
  '只输出译文 Markdown 本身，不要输出原文，不要任何解释或前言。',
].join('\n')

const KEYS = {
  settings: 'enzh-app.settings',
  terms: 'enzh-app.terms',
  autoCopy: 'enzh-app.auto-copy',
  immediate: 'enzh-app.immediate',
  termsOpen: 'enzh-app.terms-open',
  view: 'enzh-app.view',
}

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
  translatedText: '',
  translatedTerms: '',
  translatedModel: '',
  copyState: 'idle',
  selectedModel: DEFAULT_MODEL,
  models: [],
  settingsOpen: false,
  /** 是否正在显示「清空术语」确认框。 */
  confirmClear: false,
  /** 每发起一次翻译自增，用于丢弃过期响应。 */
  runId: 0,
  copyTimer: 0,
  outputKey: '',
}

const el = {}
for (const id of [
  'settings-toggle',
  'settings',
  'balance',
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
  'terms',
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
  'auto-copy-label',
  'auto-copy',
  'immediate-label',
  'immediate',
  'stale',
  'view-toggle',
  'copy',
  'progress',
  'output',
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
  state.view = readStore(KEYS.view) === 'source' ? 'source' : 'preview'
  state.selectedModel = config.model
}

function saveSettings() {
  writeStore(KEYS.settings, JSON.stringify(config))
}

/* -------------------------------------------------------------- 组合请求 */

function composeSource(text, terms) {
  const blocks = [TASK_BRIEF]
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
      state.selectedModel !== state.translatedModel)
  )
}

function renderChrome() {
  const loading = state.phase === 'loading'

  el.translate.disabled = state.input.trim().length === 0 || loading
  el.translate.textContent = loading ? '翻译中…' : '翻译'
  el.clear.disabled = state.input.length === 0

  el['char-count'].textContent = state.input.length + ' 字符'
  el.progress.hidden = !loading
  el.stale.hidden = !isStale()

  el.copy.disabled = state.output.length === 0
  el.copy.textContent =
    state.copyState === 'ok' ? '已复制' : state.copyState === 'fail' ? '复制失败' : '复制'
  el.copy.className = 'btn' + (state.copyState === 'ok' ? ' btn-ok' : state.copyState === 'fail' ? ' btn-fail' : '')

  el['view-toggle'].disabled = state.output.length === 0
  el['view-toggle'].textContent = state.view === 'preview' ? 'Markdown' : '预览'

  el['auto-copy'].checked = state.autoCopy
  el['auto-copy-label'].classList.toggle('on', state.autoCopy)

  el['immediate'].checked = state.immediate
  el['immediate-label'].classList.toggle('on', state.immediate)

  el.settings.hidden = !state.settingsOpen
  el['settings-toggle'].setAttribute('aria-expanded', String(state.settingsOpen))

  el['terms-toggle'].textContent = state.termsOpen ? '收起' : '展开'
  el['terms-body'].hidden = !state.termsOpen
  el['term-count'].textContent = String(state.terms.length)
  el['term-clear'].disabled = state.terms.length === 0
  el['confirm-modal'].hidden = !state.confirmClear
  el['term-add'].disabled = !(
    state.termSource.trim().length > 0 &&
    state.termTarget.trim().length > 0 &&
    state.terms.length < MAX_TERMS
  )
}

function renderOutput() {
  const key = state.phase + '|' + state.view + '|' + state.output + '|' + state.message
  if (key === state.outputKey) return
  state.outputKey = key

  const out = el.output

  if (state.phase === 'error') {
    out.classList.remove('md-mode')
    const box = document.createElement('div')
    box.className = 'error'
    const text = document.createElement('div')
    text.textContent = state.message
    box.appendChild(text)
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'btn'
    retry.textContent = '重试'
    retry.addEventListener('click', () => void run())
    box.appendChild(retry)
    out.replaceChildren(box)
    return
  }

  if (state.output.length === 0) {
    out.classList.remove('md-mode')
    const span = document.createElement('span')
    span.className = 'placeholder'
    span.textContent = state.phase === 'loading' ? '翻译中…' : '译文会显示在这里。'
    out.replaceChildren(span)
    return
  }

  if (state.view === 'source') {
    out.classList.remove('md-mode')
    const plain = document.createElement('div')
    plain.textContent = state.output
    out.replaceChildren(plain)
    return
  }

  out.classList.add('md-mode')
  out.innerHTML = '<div class="md">' + renderMarkdown(state.output) + '</div>'
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

    const text = document.createElement('span')
    text.className = 'term-text'
    text.title = term
    text.textContent = term

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

    row.append(text, remove)
    list.appendChild(row)
  })
}

function renderModels() {
  const select = el['model-select']
  select.replaceChildren()

  const list = state.models.length > 0 ? state.models : [{ id: config.model || DEFAULT_MODEL }]
  for (const item of list) {
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = item.id
    select.appendChild(option)
  }

  const wanted = state.selectedModel || config.model
  const exists = list.some((item) => item.id === wanted)
  select.value = exists ? wanted : list[0].id
  state.selectedModel = select.value
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

  if (config.apiKey.length === 0) {
    state.settingsOpen = true
    renderChrome()
    el['settings-hint'].textContent = '请先填写 API Key，再翻译。'
    el['api-key'].focus()
    return
  }

  const runId = state.runId + 1
  state.runId = runId

  const model = state.selectedModel || config.model

  // 同一段文本（且术语、模型都没变）已经有结果了，就不再重复发请求
  if (
    state.phase === 'done' &&
    state.output.length > 0 &&
    text === state.translatedText &&
    termsSignature() === state.translatedTerms &&
    model === state.translatedModel
  ) {
    return
  }

  state.phase = 'loading'
  state.message = ''
  render()

  try {
    const payload = await invokeTauri('translate', {
      text: composeSource(text, state.terms),
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model,
    })
    if (runId !== state.runId) return
    if (payload === null || payload === undefined || payload.ok !== true) {
      const detail =
        payload !== null &&
        payload !== undefined &&
        payload.error !== undefined &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : '翻译失败'
      throw new Error(detail)
    }

    state.output = typeof payload.translation === 'string' ? payload.translation : ''
    state.translatedText = text
    state.translatedTerms = termsSignature()
    state.translatedModel = typeof payload.model === 'string' ? payload.model : model
    state.phase = 'done'
    state.copyState = 'idle'
    render()
    void refreshBalance()

    if (state.autoCopy && state.output.length > 0) await copyText(state.output)
  } catch (error) {
    if (runId !== state.runId) return
    state.phase = 'error'
    state.message = error !== null && error !== undefined && error.message ? String(error.message) : String(error)
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
async function refreshBalance() {
  if (config.apiKey.length === 0) {
    el.balance.hidden = true
    return
  }

  const payload = await invokeTauri('balance', { apiKey: config.apiKey, baseURL: config.baseURL })
  if (payload === null || payload === undefined || payload.ok !== true) {
    el.balance.hidden = true
    return
  }
  if (typeof payload.total !== 'string' || payload.total.length === 0) {
    el.balance.hidden = true
    return
  }

  const symbol =
    payload.currency === 'USD' ? '$' : payload.currency === 'CNY' ? '¥' : String(payload.currency || '') + ' '
  el.balance.textContent = '余额 ' + symbol + payload.total
  el.balance.title =
    '充值 ' + (payload.toppedUp || '0') + ' · 赠送 ' + (payload.granted || '0') + '（点击刷新）'
  el.balance.classList.toggle('low', payload.available === false)
  el.balance.hidden = false
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
      el['settings-hint'].textContent =
        payload.models.length > 0 ? '已读取 ' + payload.models.length + ' 个模型。' : '接口没有返回模型列表，将使用默认模型。'
    } else {
      const detail =
        payload !== null &&
        payload !== undefined &&
        payload.error !== undefined &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : '读取失败'
      el['settings-hint'].textContent = '模型列表读取失败：' + detail
    }
  } catch (error) {
    el['settings-hint'].textContent = '模型列表读取失败：' + String(error && error.message ? error.message : error)
  }
  renderModels()
}

/* ---------------------------------------------------------------- 绑定 */

function bind() {
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
      render()
      return
    }

    renderChrome()
  })

  el.source.addEventListener('scroll', () => {
    el.hl.scrollTop = el.source.scrollTop
    el.hl.scrollLeft = el.source.scrollLeft
  })

  // 勾选「粘贴后翻译」后，粘贴完成即触发一次翻译
  el.source.addEventListener('paste', () => {
    if (!state.immediate) return
    window.setTimeout(() => {
      state.input = el.source.value
      syncHighlight()
      renderChrome()
      if (state.input.trim().length > 0) void run()
    }, 0)
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
    el.source.value = ''
    syncHighlight()
    render()
    el.source.focus()
  })

  el.copy.addEventListener('click', () => void copyText(state.output))

  el['view-toggle'].addEventListener('click', () => {
    state.view = state.view === 'preview' ? 'source' : 'preview'
    writeStore(KEYS.view, state.view)
    render()
  })

  el['auto-copy'].addEventListener('change', () => {
    state.autoCopy = el['auto-copy'].checked
    writeStore(KEYS.autoCopy, state.autoCopy ? '1' : '0')
    renderChrome()
  })

  el['immediate'].addEventListener('change', () => {
    state.immediate = el['immediate'].checked
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
    renderChrome()
    el['confirm-cancel'].focus()
  })

  el['confirm-cancel'].addEventListener('click', () => {
    state.confirmClear = false
    renderChrome()
    el['term-clear'].focus()
  })

  el['confirm-ok'].addEventListener('click', () => {
    state.confirmClear = false
    state.terms = []
    persistTerms()
    renderTerms()
    renderChrome()
    el['term-source'].focus()
  })

  el['confirm-modal'].addEventListener('click', (event) => {
    if (event.target !== el['confirm-modal']) return
    state.confirmClear = false
    renderChrome()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.confirmClear) return
    state.confirmClear = false
    renderChrome()
    el['term-clear'].focus()
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

  el['save-settings'].addEventListener('click', () => {
    config.apiKey = el['api-key'].value.trim()
    const base = el['base-url'].value.trim()
    config.baseURL = base.length > 0 ? base : DEFAULT_BASE_URL
    saveSettings()
    void refreshModels()
    void refreshBalance()
  })

  el['balance'].addEventListener('click', () => void refreshBalance())

  el['model-select'].addEventListener('change', () => {
    state.selectedModel = el['model-select'].value
    config.model = state.selectedModel
    saveSettings()
    renderChrome()
  })
}

/* ---------------------------------------------------------------- 启动 */

loadPersisted()
el['api-key'].value = config.apiKey
el['base-url'].value = config.baseURL === DEFAULT_BASE_URL ? '' : config.baseURL
el.source.value = state.input
bind()
renderAll()
syncHighlight()
if (config.apiKey.length > 0) {
  void refreshModels()
  void refreshBalance()
}
